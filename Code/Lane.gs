/// <summary>
/// One lane's director (the source's GameDirector): the roster, turns, frames and the tenth, the watch after each
/// throw, pin judging, booking and scoring, the announcer's call, sweeping and racking, and the crane's return.
/// The host runs it and its [State] replicates; every machine runs the same code between snapshots. It also draws
/// the lane's screen HUD for the local player: the pins, the throw speed, the scoreboard, the aim meter and the call.
/// </summary>
[Title( "Lane" ), Category( "Terryball" ), Icon( "sports_score" )]
public sealed partial class Lane : Panel
{
	public const int MaxPlayers = 6, BallsPerGame = 21;
	public const int RoundRolling = 0, RoundWatching = 1, RoundSettled = 2, RoundReturning = 3, RoundOver = 4;
	public const int NextLeave = 0, NextFresh = 1, NextEndTurn = 2;
	// GameDirector's timing
	public const float WatchSeconds = 5, MinWatchSeconds = 0.3f, SettleQuietSeconds = 0.35f, SettleSpeed = 25, SettleAngular = 1;
	public const float SettledBeat = 0.55f, RackStagger = 0.05f, CallSeconds = 3, CallFade = 0.6f;

	[Property] public int Index { get; set; }
	[Property] public Ball Ball { get; set; }

	[State] public bool Playing;
	[State] public bool AimMode = true;
	[State] public int Round;
	[State] public float RoundAge;
	[State] public float Clock;
	[State] public int RosterCount;
	[State, Size( MaxPlayers )] public int[] Roster;
	[State, Size( MaxPlayers * 3 )] public int[] Rolls;   // per player 21 balls (frames 1-9 two, the tenth three), 4 bits each: pins + 1, 0 = not thrown
	[State, Size( MaxPlayers )] public int[] SplitBits;              // which of a player's balls left a split
	[State] public int Current;          // roster index up
	[State] public int Frame;            // 0..9
	[State] public int BallNo;           // ball within the frame
	[State] public int Swept;            // pin bits swept earlier in the frame (bit n = pin n)
	[State] public int StartDown;        // pins down before this ball
	[State] public int DownBits;         // pins down now
	[State] public int Touched;          // pins the ball has touched this ball (the pocket)
	[State] public int Next;             // what follows the booked ball
	[State] public bool GameOver;
	[State] public int Call = -1;        // Label id of the latest call
	[State] public float CallAt = -100;
	[State] public int CallSerial;
	[State] public float QuietFor;
	[State] public float StallFor;
	[State] public uint Rng;

	[Local, Size( MaxPlayers * 10 )] int[] totals;

	public int BowlerSlot => RosterCount > 0 ? Roster[Current] : 0;

	protected override void OnStart()
	{
		Rng = 2463534242u + (uint)Index * 7919u;
		StartGame();
	}

	// ---------------------------------------------------------------- the game
	void StartGame()
	{
		Playing = true;
		RosterCount = 1;
		Roster[0] = 0;
		for ( int i = 0; i < MaxPlayers * 3; i++ ) Rolls[i] = 0;
		for ( int i = 0; i < MaxPlayers; i++ ) SplitBits[i] = 0;
		Current = 0;
		Frame = 0;
		BallNo = 0;
		GameOver = false;
		Swept = 0;
		StartDown = 0;
		Touched = 0;
		Call = -1;
		Rack( true );
		Ball.PlaceHome();
		SetRound( RoundRolling );
	}

	void SetRound( int r )
	{
		Round = r;
		RoundAge = 0;
		QuietFor = 0;
		StallFor = 0;
	}

	uint Random()
	{
		Rng ^= Rng << 13;
		Rng ^= Rng >> 17;
		Rng ^= Rng << 5;
		return Rng;
	}

	bool OneIn( int n ) => Random() % (uint)n == 0;

	protected override void OnFixedUpdate()
	{
		float dt = Time.Delta;
		Clock += dt;
		RoundAge += dt;
		if ( !Playing ) return;
		var input = Players.Input( BowlerSlot );
		if ( input.KeyPressed( Keys.P ) ) { StartGame(); return; }
		if ( input.KeyPressed( Keys.T ) && Round == RoundRolling && !Ball.Launched ) { AimMode = !AimMode; Ball.PlaceHome(); }

		DownBits = Judge();
		var ball = Ball.WorldPosition;
		if ( Round == RoundRolling || Round == RoundWatching ) Touched |= Touching( ball );

		if ( Round == RoundRolling )
		{
			if ( GameOver ) return;
			// the throw line starts the watch; so does a ball that has stopped past the foul line or left the lane
			bool rolledOut = Ball.Speed < SettleSpeed && (ball.x > Alley.FoulX || Ball.Launched);
			StallFor = rolledOut ? StallFor + dt : 0;
			if ( ball.x >= Alley.ThrowX || StallFor > 2 || ball.z < -2000 ) SetRound( RoundWatching );
		}
		else if ( Round == RoundWatching )
		{
			bool pinsStill = true;
			foreach ( var pin in Scene.All<Pin>() )
				if ( pin.Lane.Index == Index && !pin.Still ) pinsStill = false;
			bool ballStill = Ball.Speed <= SettleSpeed && Ball.Rigidbody.AngularVelocity.Length <= SettleAngular;
			bool past = ball.x >= Alley.DeckEndX;
			QuietFor = pinsStill && (past || ballStill) ? QuietFor + dt : 0;
			if ( RoundAge >= MinWatchSeconds && QuietFor >= SettleQuietSeconds || RoundAge >= WatchSeconds ) Settle();
		}
		else if ( Round == RoundSettled )
		{
			if ( RoundAge >= SettledBeat ) Proceed();
		}
		else if ( Round == RoundReturning )
		{
			bool racked = true;
			foreach ( var pin in Scene.All<Pin>() )
				if ( pin.Lane.Index == Index && pin.Phase == Pin.Racking ) racked = false;
			if ( Ball.Mode == Ball.Rolling && racked && RoundAge > 0.2f ) SetRound( GameOver ? RoundOver : RoundRolling );
		}
	}

	// ---------------------------------------------------------------- pins
	/// <summary>The pins down now: swept earlier in the frame, or fallen (Pin.Fallen).</summary>
	int Judge()
	{
		int bits = 0;
		foreach ( var pin in Scene.All<Pin>() )
		{
			if ( pin.Lane.Index != Index ) continue;
			int n = pin.Number;
			if ( (Swept >> n & 1) != 0 || pin.Fallen ) bits |= 1 << n;
		}
		return bits;
	}

	/// <summary>
	/// Which pins the ball is touching: its centre within a ball radius plus a pin's belly of the pin's axis. (The
	/// source counts contact events; this is the one place to swap in collision events.)
	/// </summary>
	int Touching( Vector3 ball )
	{
		int bits = 0;
		foreach ( var pin in Scene.All<Pin>() )
		{
			if ( pin.Lane.Index != Index || pin.Phase != Pin.Up ) continue;
			var a = pin.WorldPosition;
			var b = a + pin.WorldRotation.Up * Alley.PinHeight;
			var ab = b - a;
			float t = MathX.Clamp( (ball - a).Dot( ab ) / ab.Dot( ab ), 0, 1 );
			if ( (ball - (a + ab * t)).Length < Ball.Radius + 2.6f * Alley.U ) bits |= 1 << pin.Number;
		}
		return bits;
	}

	/// <summary>A full rack: instant (a new game) or animated, pin 10 first and the head pin last, released together.</summary>
	void Rack( bool instant )
	{
		Swept = 0;
		foreach ( var pin in Scene.All<Pin>() )
		{
			if ( pin.Lane.Index != Index ) continue;
			pin.RackTo( instant, (10 - pin.Number) * RackStagger, 9 * RackStagger + Pin.RackSeconds );
		}
	}

	/// <summary>The down pins go; the standing ones are set straight on their spots.</summary>
	void SweepAndRespot()
	{
		float release = 0;
		foreach ( var pin in Scene.All<Pin>() )
			if ( pin.Lane.Index == Index && (DownBits >> pin.Number & 1) == 0 ) release = MathF.Max( release, (10 - pin.Number) * RackStagger );
		release += Pin.RackSeconds;
		foreach ( var pin in Scene.All<Pin>() )
		{
			if ( pin.Lane.Index != Index ) continue;
			if ( (DownBits >> pin.Number & 1) != 0 ) pin.Sweep();
			else pin.RackTo( false, (10 - pin.Number) * RackStagger, release );
		}
		Swept |= DownBits;
	}

	// ---------------------------------------------------------------- booking
	public static int Slot( int frame, int ball ) => frame < 9 ? frame * 2 + ball : 18 + ball;
	public int RollOf( int player, int frame, int ball ) => RawRoll( player, Slot( frame, ball ) );
	public int RawRoll( int player, int slot ) => (Rolls[player * 3 + slot / 8] >> (4 * (slot % 8)) & 15) - 1;
	void SetRoll( int player, int slot, int pins )
	{
		int i = player * 3 + slot / 8, shift = 4 * (slot % 8);
		Rolls[i] = (Rolls[i] & ~(15 << shift)) | ((pins + 1) << shift);
	}

	static int Count( int bits )
	{
		int n = 0;
		for ( int i = 1; i <= 10; i++ ) n += bits >> i & 1;
		return n;
	}

	/// <summary>The settled ball: count it, book it, call it, and decide what follows.</summary>
	void Settle()
	{
		int knocked = Math.Clamp( Count( DownBits ) - StartDown, 0, 10 );
		int p = Current;
		SetRoll( p, Slot( Frame, BallNo ), knocked );
		bool split = false;
		Call = Classify( p, knocked, ref split );
		if ( split ) SplitBits[p] |= 1 << Slot( Frame, BallNo );
		CallAt = Clock;
		CallSerial++;
		Next = Decide( p );
		SetRound( RoundSettled );
	}

	int Decide( int p )
	{
		int r0 = RollOf( p, Frame, 0 ), r1 = RollOf( p, Frame, 1 );
		if ( Frame < 9 ) return r0 == 10 || BallNo >= 1 ? NextEndTurn : NextLeave;
		if ( BallNo == 0 ) return r0 == 10 ? NextFresh : NextLeave;
		if ( BallNo == 1 )
		{
			if ( r0 != 10 && r0 + r1 < 10 ) return NextEndTurn;
			bool fresh = r0 == 10 ? r1 == 10 : true;
			return fresh ? NextFresh : NextLeave;
		}
		return NextEndTurn;
	}

	void Proceed()
	{
		if ( Next == NextLeave )
		{
			SweepAndRespot();
			StartDown = Count( Swept );
			BallNo++;
		}
		else if ( Next == NextFresh )
		{
			Rack( false );
			StartDown = 0;
			BallNo++;
		}
		else
		{
			Current++;
			if ( Current >= RosterCount ) { Current = 0; Frame++; }
			BallNo = 0;
			StartDown = 0;
			if ( Frame >= 10 ) { GameOver = true; Frame = 9; }
			else Rack( false );
		}
		Touched = 0;
		Ball.FlyHome();
		SetRound( RoundReturning );
	}

	// ---------------------------------------------------------------- the announcer's call (ClassifyCall)
	/// <summary>Was ball b of frame f thrown at a fresh rack, and how many pins stood before it.</summary>
	bool Fresh( int p, int f, int b, out int before )
	{
		int r0 = RollOf( p, f, 0 ), r1 = RollOf( p, f, 1 );
		before = 10;
		if ( b == 0 ) return true;
		if ( f < 9 ) { before = 10 - r0; return false; }
		if ( b == 1 )
		{
			if ( r0 == 10 ) return true;
			before = 10 - r0;
			return false;
		}
		if ( r0 == 10 && r1 == 10 || r0 != 10 && r0 + r1 == 10 ) return true;
		before = 10 - r1;
		return false;
	}

	int Classify( int p, int knocked, ref bool split )
	{
		int before;
		bool fresh = Fresh( p, Frame, BallNo, out before );
		if ( fresh )
		{
			if ( knocked == 10 )
			{
				int streak = Streak( p );
				if ( streak >= 12 ) return Label.PerfectGame;
				if ( streak < 2 && (Touched >> 1 & 1) != 0 && (Touched & 12) != 0 && OneIn( 3 ) ) return Label.Pocket;
				if ( streak == 2 ) return Label.Double;
				if ( streak == 3 ) return Label.Turkey;
				if ( streak == 4 ) return Label.FourBagger;
				if ( streak == 5 ) return Label.FiveBagger;
				if ( streak >= 6 ) return Label.SixPack;
				return Label.Strike;
			}
			if ( knocked == 0 ) return Label.Gutter;
			int standing = ~DownBits & 2046;
			if ( (DownBits >> 1 & 1) != 0 && IsSplit( standing ) ) { split = true; return Label.Split; }
			if ( knocked == 9 ) return standing == 1 << 7 || standing == 1 << 10 ? Label.Nine : Label.SoClose;
			return Label.One + knocked - 1;
		}
		if ( knocked == before )
		{
			if ( BallNo >= 1 && (SplitBits[p] >> Slot( Frame, BallNo - 1 ) & 1) != 0 ) return Label.Nice;
			if ( before >= 3 && OneIn( 4 ) ) return Label.Nice;
			return Label.Spare;
		}
		if ( knocked == 0 ) return Label.Miss;
		return OneIn( 2 ) ? Label.GoodTry : Label.OpenFrame;
	}

	/// <summary>Consecutive fresh-rack strikes ending with the ball just booked (tenth-frame bonus balls included).</summary>
	int Streak( int p )
	{
		int streak = 0;
		for ( int f = 0; f <= Frame; f++ )
			for ( int b = 0; b < 3; b++ )
			{
				if ( f < 9 && b > 1 ) break;
				if ( f == Frame && b > BallNo ) break;
				int r = RollOf( p, f, b );
				if ( r < 0 ) break;
				int before;
				bool fresh = Fresh( p, f, b, out before );
				streak = fresh && r == 10 ? streak + 1 : 0;
			}
		return streak;
	}

	// pin adjacency (the source's split graph), bit n = pin n
	static readonly int[] Adjacent = {
		0, (1 << 2) | (1 << 3), (1 << 1) | (1 << 3) | (1 << 4) | (1 << 5), (1 << 1) | (1 << 2) | (1 << 5) | (1 << 6),
		(1 << 2) | (1 << 5) | (1 << 7) | (1 << 8), (1 << 2) | (1 << 3) | (1 << 4) | (1 << 6) | (1 << 8) | (1 << 9),
		(1 << 3) | (1 << 5) | (1 << 9) | (1 << 10), (1 << 4) | (1 << 8), (1 << 4) | (1 << 5) | (1 << 7) | (1 << 9),
		(1 << 5) | (1 << 6) | (1 << 8) | (1 << 10), (1 << 6) | (1 << 9),
	};

	/// <summary>Two or more standing pins that don't all connect through standing neighbours.</summary>
	public static bool IsSplit( int standing )
	{
		if ( Count( standing ) < 2 ) return false;
		int first = 0;
		for ( int n = 10; n >= 1; n-- ) if ( (standing >> n & 1) != 0 ) first = n;
		int reached = 1 << first;
		for ( int k = 0; k < 10; k++ )
		{
			int grow = reached;
			for ( int n = 1; n <= 10; n++ ) if ( (reached >> n & 1) != 0 ) grow |= Adjacent[n] & standing;
			reached = grow;
		}
		return reached != standing;
	}

	// ---------------------------------------------------------------- scoring (ScoreThrough)
	protected override void OnUpdate()
	{
		for ( int p = 0; p < MaxPlayers; p++ ) Totals( p );
	}

	void Totals( int p )
	{
		var r = new int[BallsPerGame];
		int n = 0;
		for ( int s = 0; s < BallsPerGame; s++ )
		{
			int v = RawRoll( p, s );
			if ( v >= 0 ) { r[n] = v; n++; }
		}
		for ( int f = 0; f < 10; f++ ) totals[p * 10 + f] = -1;
		int run = 0, i = 0;
		for ( int f = 0; f < 10; f++ )
		{
			if ( f == 9 )
			{
				if ( i >= n ) break;
				int need = r[i] == 10 || i + 1 < n && r[i] + r[i + 1] == 10 ? 3 : 2;
				if ( i + need > n ) break;
				for ( int k = 0; k < need; k++ ) run += r[i + k];
				totals[p * 10 + f] = run;
				break;
			}
			if ( i < n && r[i] == 10 )
			{
				if ( i + 2 >= n ) break;
				run += 10 + r[i + 1] + r[i + 2];
				i += 1;
			}
			else if ( i + 1 < n && r[i] + r[i + 1] == 10 )
			{
				if ( i + 2 >= n ) break;
				run += 10 + r[i + 2];
				i += 2;
			}
			else if ( i + 1 < n )
			{
				run += r[i] + r[i + 1];
				i += 2;
			}
			else break;
			totals[p * 10 + f] = run;
		}
	}

	/// <summary>The mark in box k of frame f (an ASCII code, 0 = blank): X, /, - or a count.</summary>
	public int Mark( int p, int f, int k )
	{
		int b0 = RollOf( p, f, 0 ), b1 = RollOf( p, f, 1 );
		if ( f < 9 )
		{
			if ( b0 == 10 ) return k == 1 ? 88 : 0;
			if ( k == 0 ) return Sym( b0 );
			if ( b1 < 0 ) return 0;
			return b0 + b1 == 10 ? 47 : Sym( b1 );
		}
		int b2 = RollOf( p, f, 2 );
		if ( k == 0 ) return b0 == 10 ? 88 : Sym( b0 );
		if ( k == 1 )
		{
			if ( b1 < 0 ) return 0;
			if ( b0 == 10 ) return b1 == 10 ? 88 : Sym( b1 );
			return b0 + b1 == 10 ? 47 : Sym( b1 );
		}
		if ( b2 < 0 ) return 0;
		bool fresh = b0 == 10 ? b1 == 10 : true;
		if ( fresh ) return b2 == 10 ? 88 : Sym( b2 );
		return b1 + b2 == 10 ? 47 : Sym( b2 );
	}

	static int Sym( int v ) => v < 0 ? 0 : v == 0 ? 45 : 48 + v;

	public int Total( int p, int f ) => totals[p * 10 + f];
}
