/// <summary>
/// The lane's ball: a 200-unit glass sphere (8.5 real inches at lane scale) with Terry riding inside (Rider.gs).
/// Free throws drive it with WASD (camera-relative force toward a target velocity, a brake without input); aimed
/// throws hold it at the foul line through four meter steps (LINE, AIM, POWER, SPIN) and launch it with forward roll
/// and side rotation. Inside the solver (OnPhysicsStep) it brakes in the pit and hooks on the dry back end of the
/// lane: Coulomb friction against the contact patch's slip, applied at the contact point, so the same force that
/// curves the path revs the side spin down. It draws its own glass shell and its coloured shadow in one screen pass.
/// </summary>
[Title( "Ball" ), Category( "Terryball" ), Icon( "sports_baseball" ), RenderOrder( -10 )]
public sealed class Ball : GpuComponent
{
	// free drive (BallController)
	public const float MaxSpeed = 5625, DriveGain = 6.5f, BrakeGain = 20, PitDamping = 6;
	public const float AngularDamping = 0.1f, HookCoastAngularDamping = 0.005f;
	// oil and hook
	public const float OilFrontFraction = 0.6f, HookAccel = 900, HookSlipDeadband = 40;
	// the aimed throw (ThrowAimer)
	public const float MinLaunchSpeed = 3200, MaxLaunchSpeed = 6200, MaxAimDegrees = 9, LaunchRollFraction = 0.5f, SideRotationRate = 32;
	public const float SweetSpot = 0.8f, KeySpeed = 0.9f, MouseSpeed = 0.02f;
	public const float UnitsToMph = 8.5f / (2 * Alley.R) / 17.6f;
	// the camera (BallCamera)
	public const float CamDistance = 700, CamHeight = 60, MinPitch = -5, MaxPitch = 15, WatchBack = 1400, WatchHeight = 700;
	public const float AimPitch = 10, AimHeight = 150;
	// crane flights
	public const float CraneSpeed = 12700, CraneMinTravel = 0.45f, CraneLift = 500, CraneLiftSeconds = 0.5f, CraneHover = 0.4f, CraneArc = 260;

	public const int Rolling = 0, Flying = 1, Parked = 2;
	// crane legs
	public const int LegMove = 0, LegArc = 1, LegWait = 2, LegScoop = 3, LegDrop = 4, LegHome = 5, LegPark = 6;
	public const float CraneAbove = 230, CraneAboveSeconds = 0.55f, CraneSink = 0.6f, Pelvis = 38;
	public const int StepLine = 0, StepAim = 1, StepPower = 2, StepSpin = 3, StepThrown = 4;

	[Property] public Lane Lane { get; set; }
	[Property] public float Radius { get; set; } = 100;

	[State] public int Mode;
	[State] public bool Locked;              // controls locked: the ball coasts on physics alone
	[State] public bool Launched;            // an aimed throw is on its way
	[State] public float Hook;               // side spin of the aimed throw (-1..1); hooks only while locked
	[State] public int Step;                 // aim meter step
	[State] public float Caret;              // the live step's caret, 0 = screen left
	[State, Size( 4 )] public float[] Set;    // the committed carets
	[State] public Vector3 HoldAt;           // where the held ball eases to while lining up
	[State] public Vector3 Wish;             // drive target velocity (horizontal), from the bowler's input
	[State] public float ThrowMph;           // latched at the throw line
	[State] public float CamYaw;  // free drive is relative to the bowler's camera
	[State] public float CamPitch;
	// a crane flight (the director's Return): lift, hover, arc to the run-up
	[State] public int CarriedSlot = -1;     // the bowler riding inside (-1: nobody)
	[State] public int CraneSlot = -1;       // the bowler the crane is fetching or setting down
	[State, Size( 10 )] public Vector3[] LegTo;
	[State, Size( 10 )] public float[] LegTime;
	[State, Size( 10 )] public int[] LegKind;
	[State] public int LegCount, Leg;
	[State] public float LegAge;
	[State] public Vector3 LegFrom;
	[State] public bool Lifting;             // the first lift of a Return or Drop-off: the camera keeps watching

	[Local] float watchBlend;
	[Local] float flyCam;
	[Local] Vector3 camPos;
	[Local] Rotation camRot;
	[Local] bool camInit;
	[Local] public float RollSpeed;          // audio: speed from the position change (every machine hears the same roll)
	[Local] public float RollOn;             // audio: 1 while the ball rolls on the lane, 0 in the air, the pit or the crane
	[Local] Vector3 heardAt;
	[Local] bool heardInit;
	[Local, Size( 6 )] public float[] Track;   // diagnostics: the ball's y every 3000 units down the lane
	[Local] public float TrackZ = 1e9f;
	[Local] float camYaw, camPitchE, camHeight, camFollowY;

	uint Category => 2u << Lane.Index;
	float LaneY => Lane.WorldPosition.y;
	int Bowler => Lane.BowlerSlot;
	/// <summary>A committed caret (another component reads one element at a time).</summary>
	public float SetOf( int step ) => Set[step];
	public bool IsLocal => Bowler == Players.Local;
	PlayerInput Input => Players.Input( Bowler );
	public Vector3 Home => new Vector3( Alley.RunUpX, LaneY, Alley.H + Radius );
	/// <summary>Lining up an aimed throw: held at the foul line, the meter up.</summary>
	public bool LiningUp => Mode == Rolling && CarriedSlot >= 0 && Lane.AimMode && Lane.Round == Lane.RoundRolling && Step < StepThrown && Lane.Playing && !Lane.GameOver;
	public float Speed => Rigidbody.Velocity.Length;

	protected override void OnStart()
	{
		Mode = Rolling;
		Caret = 0.5f;
		Set[0] = 0.5f; Set[1] = 0.5f; Set[2] = 0; Set[3] = 0.5f;
	}

	/// <summary>Back to the run-up at rest (the director's PlaceBallHome), the meter reset.</summary>
	[Message]
	public void PlaceHome()
	{
		Mode = Rolling;
		Rigidbody.SetCollisionFilter( Category, 1u | Category );
		Rigidbody.SetTransform( Home, Rotation.Identity );
		Rigidbody.SetVelocity( Vector3.Zero, Vector3.Zero );
		ResetThrow();
	}

	void ResetThrow()
	{
		Launched = false;
		Hook = 0;
		Step = StepLine;
		Caret = 0.5f;
		Set[0] = 0.5f; Set[1] = 0.5f; Set[2] = 0; Set[3] = 0.5f;
		ThrowMph = 0;
		HoldAt = Home;
	}

	// ---------------------------------------------------------------- the crane (GameDirector's crane jobs)
	void Legs() { LegCount = 0; Leg = 0; LegAge = 0; LegFrom = WorldPosition; Mode = Flying; }
	void Add( int kind, Vector3 to, float time ) { LegKind[LegCount] = kind; LegTo[LegCount] = to; LegTime[LegCount] = time; LegCount++; }
	float Travel( Vector3 a, Vector3 b ) => MathF.Max( CraneMinTravel, a.Distance( b ) / CraneSpeed );
	static Vector3 Rest( Vector3 foot ) => foot + Vector3.Up * Pelvis;

	/// <summary>Return: lift, hover, an arc back to the run-up, roll.</summary>
	[Message]
	public void FlyHome( bool crane )
	{
		Legs();
		var top = WorldPosition + Vector3.Up * CraneLift;
		if ( crane ) { Add( LegMove, top, CraneLiftSeconds ); Add( LegWait, top, CraneHover ); Add( LegArc, Home, Travel( top, Home ) ); }
		Add( LegHome, Home, 0 );
		Lifting = crane;
	}

	/// <summary>Pickup: fly over the bowler, sink, scoop them in, rise, fly to the run-up, roll.</summary>
	[Message]
	public void Pickup( int slot, Vector3 foot, bool crane )
	{
		Legs();
		CraneSlot = slot;
		var rest = Rest( foot ); var above = rest + Vector3.Up * CraneAbove;
		if ( crane )
		{
			var from = WorldPosition;
			Add( LegArc, above, Travel( from, above ) ); Add( LegWait, above, CraneAboveSeconds ); Add( LegMove, rest, CraneSink );
			Add( LegScoop, rest, 0 ); Add( LegMove, above, CraneSink ); Add( LegWait, above, CraneAboveSeconds );
			Add( LegArc, Home, Travel( above, Home ) );
		}
		else Add( LegScoop, rest, 0 );
		Add( LegHome, Home, 0 );
		Lifting = false;
	}

	/// <summary>Drop-off: lift, hover, fly over the seat, sink, set the bowler down, rise, and wait there.</summary>
	[Message]
	public void Dropoff( Vector3 seat, bool crane )
	{
		Legs();
		CraneSlot = CarriedSlot;
		var rest = Rest( seat ); var above = rest + Vector3.Up * CraneAbove;
		if ( crane )
		{
			var top = WorldPosition + Vector3.Up * CraneLift;
			Add( LegMove, top, CraneLiftSeconds ); Add( LegWait, top, CraneHover ); Add( LegArc, above, Travel( top, above ) );
			Add( LegWait, above, CraneAboveSeconds ); Add( LegMove, rest, CraneSink ); Add( LegDrop, seat, 0 );
			Add( LegMove, above, CraneSink ); Add( LegWait, above, CraneAboveSeconds );
		}
		else Add( LegDrop, seat, 0 );
		Add( LegPark, above, 0 );
		Lifting = crane;
	}

	/// <summary>Out of the game at once (STOP): the rider is set down on the seat, the ball goes home.</summary>
	[Message]
	public void Release( Vector3 seat )
	{
		if ( CarriedSlot >= 0 ) foreach ( var b in Scene.All<Bowler>() ) if ( b.Slot == CarriedSlot ) b.Drop( seat );
		CarriedSlot = -1;
		CraneSlot = -1;
		PlaceHome();
	}

	Vector3 LegPosition()
	{
		int k = LegKind[Leg];
		var to = LegTo[Leg];
		float t = LegTime[Leg] > 0 ? MathX.Clamp( LegAge / LegTime[Leg], 0, 1 ) : 1;
		float e = MathX.SmoothStep( 0, 1, t );
		if ( k == LegArc ) return Vector3.Lerp( LegFrom, to, e ) + Vector3.Up * CraneArc * MathF.Sin( e * MathF.PI );
		if ( k == LegMove ) return Vector3.Lerp( LegFrom, to, e );
		return LegFrom;
	}

	void Crane( float dt )
	{
		LegAge += dt;
		// legs that take no time run their event and end at once
		for ( int guard = 0; guard < 10 && Leg < LegCount; guard++ )
		{
			int k = LegKind[Leg];
			if ( k == LegScoop )
			{
				foreach ( var b in Scene.All<Bowler>() ) if ( b.Slot == CraneSlot ) b.Scoop();
				CarriedSlot = CraneSlot;
			}
			else if ( k == LegDrop )
			{
				foreach ( var b in Scene.All<Bowler>() ) if ( b.Slot == CraneSlot ) b.Drop( LegTo[Leg] );
				CarriedSlot = -1;
			}
			else if ( k == LegHome ) { CraneSlot = -1; PlaceHome(); return; }
			else if ( k == LegPark ) { Mode = Parked; LegFrom = LegTo[Leg]; Leg = LegCount; break; }
			else if ( LegAge < LegTime[Leg] ) break;
			if ( k == LegMove || k == LegArc ) LegFrom = LegTo[Leg];
			if ( Leg == 0 ) Lifting = false;
			LegAge = 0;
			Leg++;
		}
		// one filter command per body per tick: commands in one tick are applied in no set order
		Rigidbody.SetCollisionFilter( Category, 0 );
		Rigidbody.SetTransform( Leg < LegCount ? LegPosition() : LegFrom, Rotation.Slerp( WorldRotation, Rotation.Identity, MathF.Min( 1, dt * 3 ) ) );
		Rigidbody.SetVelocity( Vector3.Zero, Vector3.Zero );
	}

	protected override void OnFixedUpdate()
	{
		float dt = Time.Delta;
		var input = Input;
		if ( !IsLocal ) Look( input.LookDelta );

		if ( Mode == Flying || Mode == Parked ) { Crane( dt ); return; }

		bool canPlay = Lane.Playing && !Lane.GameOver && Lane.Round == Lane.RoundRolling;
		Locked = !canPlay || Launched || Lane.AimMode;
		Wish = Vector3.Zero;
		if ( canPlay && !Lane.AimMode )
		{
			if ( Launched ) ResetThrow();
			// camera-relative WASD (BallController): forward along the camera's yaw, left across it
			var move = input.AnalogMove;
			var f = Rotation.FromYaw( CamYaw ).Forward;
			var l = new Vector3( -f.y, f.x, 0 );
			var wish = f * move.x + l * move.y;
			if ( wish.Length > 1 ) wish = wish.Normal;
			Wish = wish * MaxSpeed;
		}
		if ( LiningUp ) Aim( input, dt );
		if ( !Lane.AimMode || Launched ) Hook = Launched ? Hook : 0;

		// the throw line latches the speed for the HUD; it re-arms behind the foul line
		var pos = WorldPosition;
		if ( Launched && Lane.Round == Lane.RoundRolling ) { int k = (int)MathX.Clamp( (pos.x - Alley.FoulX) / 3000, 0, 5 ); Track[k] = pos.y - LaneY; TrackZ = MathF.Min( TrackZ, pos.z ); }
		if ( ThrowMph == 0 && pos.x >= Alley.ThrowX ) ThrowMph = MathF.Max( Speed * UnitsToMph, 0.06f );
		if ( pos.x < Alley.FoulX && !Launched ) ThrowMph = 0;
	}

	/// <summary>The four-step aimed throw: A/D or mouse yaw move the caret, click/space commits, right click steps back.</summary>
	void Aim( PlayerInput input, float dt )
	{
		Caret = MathX.Clamp( Caret - input.AnalogMove.y * KeySpeed * dt - input.LookDelta.yaw * MouseSpeed, 0, 1 );
		bool commit = input.Pressed( "Attack1" ) || input.Pressed( "Jump" );
		bool back = input.Pressed( "Attack2" ) || input.KeyPressed( 8 );
		if ( back && Step > StepLine )
		{
			Step--;
			Caret = Set[Step];
		}
		else if ( commit )
		{
			Set[Step] = Caret;
			Step++;
			if ( Step == StepThrown ) Launch();
			else Caret = Set[Step];
		}
		// held at the foul line on the chosen line, gravity cancelled by placing it every tick
		float line = Step == StepLine ? Caret : Set[StepLine];
		float yRange = MathF.Max( 0, Alley.LaneHalf - Radius );
		var target = new Vector3( Alley.FoulX - 1.5f * Radius, LaneY + (1 - 2 * line) * yRange, Alley.H + Radius + 2 );
		if ( Step < StepThrown )
		{
			HoldAt = Vector3.Lerp( WorldPosition, target, 1 - MathF.Exp( -8 * dt ) );
			Rigidbody.SetTransform( HoldAt, Rotation.Identity );
			Rigidbody.SetVelocity( Vector3.Zero, Vector3.Zero );
		}
	}

	void Launch()
	{
		float aimDeg = (1 - 2 * Set[StepAim]) * MaxAimDegrees;
		float power = Set[StepPower];
		float spin = 1 - 2 * Set[StepSpin];
		var dir = Rotation.FromYaw( aimDeg ).Forward;
		float v = MathX.Lerp( MinLaunchSpeed, MaxLaunchSpeed, power );
		var w = dir.Cross( Vector3.Up ) * (v / Radius * LaunchRollFraction) - dir * (spin * SideRotationRate);
		Rigidbody.SetVelocity( dir * v, w );
		Hook = spin;
		Launched = true;
		for ( int k = 0; k < 6; k++ ) Track[k] = 0;
		TrackZ = 1e9f;
	}

	/// <summary>Inside the solver, every substep: drive, brake, pit damping, the hook, angular damping.</summary>
	protected override void OnPhysicsStep()
	{
		if ( Mode != Rolling ) return;
		float h = PhysicsStep.Delta;
		var v = PhysicsStep.Velocity;
		var w = PhysicsStep.AngularVelocity;
		var p = PhysicsStep.Position;
		var horiz = v.WithZ( 0 );
		if ( !Locked )
		{
			bool input = Wish.Length > 1;
			// force = (target - vel) * gain on a 5.3 mass: the speed approaches the target at gain / mass per second
			v += (Wish - horiz) * ((input ? DriveGain : BrakeGain) / 5.3f) * h;
		}
		if ( Locked && p.x > Alley.DeckEndX )
		{
			float k = MathF.Exp( -PitDamping * h );
			v *= k;
			w *= k;
		}
		bool hooking = Locked && MathF.Abs( Hook ) > 0.001f;
		float speed = horiz.Length;
		if ( hooking && speed > 50 )
		{
			// oil: dry from OilFrontFraction of the way to the pin deck, smoothstepped
			float prog = MathX.Clamp( (p.x - Alley.FoulX) / MathF.Max( 1, Alley.DeckCenterX - Alley.FoulX ), 0, 1 );
			float t = MathX.Clamp( (prog - OilFrontFraction) / (1 - OilFrontFraction), 0, 1 );
			float oil = t * t * (3 - 2 * t);
			var dir = horiz / speed;
			var lat = Vector3.Up.Cross( dir );
			var r = new Vector3( 0, 0, -Radius );
			var contact = w.Cross( r );
			float slip = (horiz + contact).Dot( lat );
			if ( MathF.Abs( slip ) >= HookSlipDeadband )
			{
				// Coulomb friction at the contact point: the slip can at most be cancelled in this step
				float a = -MathF.Sign( slip ) * MathF.Min( HookAccel * oil, MathF.Abs( slip ) / h );
				v += lat * a * h;
				// torque r x F on a solid sphere (I = 2/5 m R^2)
				w += r.Cross( lat ) * (a * h / (0.4f * Radius * Radius));
			}
		}
		w *= MathF.Exp( -(hooking ? HookCoastAngularDamping : AngularDamping) * h );
		// write through this body's step handle (PhysicsStep.Velocity is read-only to GPU#)
		var me = Rigidbody;
		for ( int i = 0; i < PhysicsStep.BodyCount; i++ )
		{
			var b = PhysicsStep.Body( i );
			if ( b.Rigidbody != me ) continue;
			b.Velocity = v;
			b.AngularVelocity = w;
			break;
		}
	}

	void Look( Angles d )
	{
		CamYaw += d.yaw;
		CamPitch = MathX.Clamp( CamPitch - d.pitch, MinPitch, MaxPitch );
	}

	/// <summary>
	/// The ball's sound, on every machine (BallAudio): the throw one-shot as the ball crosses the foul line (re-armed
	/// behind it), and the roll's inputs for OnAudio, taken from the position change so a client hears what it sees.
	/// </summary>
	void Listen( float dt )
	{
		var p = WorldPosition;
		if ( !heardInit ) { heardAt = p; heardInit = true; }
		float v = (p - heardAt).WithZ( 0 ).Length / MathF.Max( dt, 1e-4f );
		bool onLane = Mode == Rolling && MathF.Abs( p.z - (Alley.H + Radius) ) < 30 && p.x > Alley.ApproachX && p.x < Alley.DeckEndX;
		RollSpeed = MathX.Lerp( RollSpeed, v, 1 - MathF.Exp( -12 * dt ) );
		RollOn = MathX.Lerp( RollOn, onLane ? 1 : 0, 1 - MathF.Exp( -10 * dt ) );
		if ( Mode == Rolling && heardAt.x < Alley.FoulX && p.x >= Alley.FoulX && v > 300 )
		{
			float near = Hearing( p, 9000 );
			if ( near > 0.01f ) Sound.Play2D( Sounds.Throw, 0.9f * near, 0.95f + 0.1f * MathX.Fract( p.y * 0.013f ) );
		}
		heardAt = p;
	}

	/// <summary>How loud a sound at p is for this machine's camera: 1 at hand, 0 past range.</summary>
	public static float Hearing( Vector3 p, float range )
	{
		float d = (p - Camera.Main.WorldPosition).Length / range;
		return MathX.Clamp( 1 - d, 0, 1 ) * MathX.Clamp( 1 - d, 0, 1 );
	}

	/// <summary>The roll (BallAudio's synthesised rumble): low tones that rise with speed, a once-per-revolution thump, grit.</summary>
	protected override Vector2 OnAudio( float t )
	{
		float on = RollOn;
		if ( on < 0.001f ) return Vector2.Zero;
		float s = RollSpeed;
		float level = MathX.Clamp( s / 5000, 0, 1 );
		float rev = s / (MathF.Tau * Radius);
		float thump = MathF.Pow( 0.5f + 0.5f * MathF.Sin( MathF.Tau * Audio.Oscillator( 2, rev ) ), 8 );
		float rumble = 0.6f * MathF.Sin( MathF.Tau * Audio.Oscillator( 0, 38 + s * 0.006f ) )
			+ 0.35f * MathF.Sin( MathF.Tau * Audio.Oscillator( 1, 61 + s * 0.009f ) )
			+ 0.2f * MathF.Sin( MathF.Tau * Audio.Oscillator( 3, 97 + s * 0.013f ) );
		float grit = Audio.Noise() * (0.05f + 0.08f * level);
		float mono = (rumble * (0.75f + 0.5f * thump) + grit) * level * on * 0.55f;
		return Audio.At( WorldPosition, mono, 9000 );
	}

	/// <summary>The bowler's camera: behind the ball, the aim view while lining up, the pin deck while watching.</summary>
	protected override void OnUpdate()
	{
		Listen( Time.Delta );
		if ( CarriedSlot != Players.Local || CarriedSlot < 0 ) return;
		float dt = Time.Delta;
		Look( Input.LookDelta );
		var ball = WorldPosition;
		bool lining = LiningUp;
		// the aim view eases in and out (yaw pinned down-lane, higher, pitched down); the anchor itself is exact
		float ease = 1 - MathF.Exp( -6 * dt );
		camYaw = MathX.Lerp( camYaw, lining ? 0 : CamYaw, camInit ? ease : 1 );
		camPitchE = MathX.Lerp( camPitchE, lining ? AimPitch : CamPitch, camInit ? ease : 1 );
		camHeight = MathX.Lerp( camHeight, lining ? AimHeight : CamHeight, camInit ? ease : 1 );
		camFollowY = lining ? MathX.Lerp( camFollowY, ball.y, camInit ? MathF.Min( 1, 6 * dt ) : 1 ) : ball.y;
		camInit = true;
		var rot = Rotation.From( camPitchE, camYaw, 0 );
		var anchor = new Vector3( ball.x, camFollowY, ball.z );
		var play = anchor + Vector3.Up * camHeight - rot.Forward * CamDistance;

		bool watching = Lane.Round == Lane.RoundWatching || Lane.Round == Lane.RoundSettled || Mode == Flying && Lifting;
		watchBlend = MathX.Lerp( watchBlend, watching ? 1 : 0, MathF.Min( 1, 4 * dt ) );
		var deck = new Vector3( Alley.DeckCenterX, LaneY, Alley.H );
		var watchPos = deck + new Vector3( -WatchBack, 0, WatchHeight );
		var watchRot = Rotation.LookAt( (deck - watchPos).Normal );
		camPos = Vector3.Lerp( play, watchPos, watchBlend );
		camRot = Rotation.Slerp( rot, watchRot, watchBlend );
		Camera.Set( camPos, camRot, 70, 10, 60000 );
	}

	// ---------------------------------------------------------------- the glass shell and its coloured shadow
	/// <summary>The ball design's colour in a direction from the centre (ball space): HalfHalf, red over blue.</summary>
	static Vector3 Design( Vector3 d )
	{
		float v = 0.5f - MathF.Asin( MathX.Clamp( d.z, -1, 1 ) ) / MathF.PI;   // 0 = north pole
		if ( MathF.Abs( v - 0.5f ) < 0.035f ) return new Vector3( 0.05f, 0.05f, 0.06f );
		return v < 0.5f ? Hsv( 0, 0.85f, 1 ) : Hsv( 220, 0.85f, 1 );
	}

	static Vector3 Hsv( float h, float s, float v )
	{
		var k = new Vector3( 5, 3, 1 ) + Vector3.One * (h / 60);
		var c = new Vector3( Glsl.mod( k.x, 6 ), Glsl.mod( k.y, 6 ), Glsl.mod( k.z, 6 ) );
		var f = new Vector3( MathX.Clamp( MathF.Min( c.x, 4 - c.x ), 0, 1 ), MathX.Clamp( MathF.Min( c.y, 4 - c.y ), 0, 1 ), MathX.Clamp( MathF.Min( c.z, 4 - c.z ), 0, 1 ) );
		var rgb = (Vector3.One - f * s) * v;
		// sRGB design colours to linear
		return new Vector3( MathF.Pow( rgb.x, 2.2f ), MathF.Pow( rgb.y, 2.2f ), MathF.Pow( rgb.z, 2.2f ) );
	}

	/// <summary>The design at a world point on the shell.</summary>
	Vector3 ShellColour( Vector3 p ) => Design( WorldRotation.Inverse * (p - WorldPosition).Normal );

	[Draw( After = Stage.Lighting )]
	Color Glass( in ScreenPixel px )
	{
		var col = px.Color.Rgb;
		var c = WorldPosition;
		float R = Radius;
		// the shadow: where the ray from this pixel to the sun passes through the ball, its colours (both crossings,
		// averaged) multiply the light that reached the pixel; Terry inside casts his own, real shadow
		if ( px.Depth < 1e20f )
		{
			var p = px.WorldPosition;
			var sun = Render.SunDirection;
			var s = Intersect.Sphere( p, sun, c, R );
			if ( s.Hit && s.Far > 0 && (p - c).Length > R * 1.01f )
			{
				var tint = (ShellColour( p + sun * s.Near ) + ShellColour( p + sun * s.Far )) * 0.5f;
				// how deep the ray cuts through the ball: a soft edge at the rim
				float chord = MathX.Clamp( (s.Far - MathF.Max( s.Near, 0 )) / (R * 0.35f), 0, 1 );
				var sat = Vector3.Lerp( Vector3.One * (tint.x * 0.3f + tint.y * 0.59f + tint.z * 0.11f), tint, 0.85f );
				col *= Vector3.Lerp( Vector3.One, sat * 0.55f + Vector3.One * 0.08f, chord );
			}
		}
		// the shell: see-through glass over whatever is behind (Terry, the lane), refracted a little
		var eye = Render.CameraPosition;
		var hit = Intersect.Sphere( eye, px.ViewDir, c, R );
		if ( !hit.Hit || hit.Near <= 0 || hit.Near > px.Depth ) return new Color( col.x, col.y, col.z, 1 );
		var n = hit.Normal;
		float facing = MathF.Abs( n.Dot( px.ViewDir ) );
		float fresnel = 0.04f + 0.96f * MathF.Pow( 1 - facing, 5 );
		// refraction: the view behind is pulled toward the rim
		var bend = Render.WorldToScreen( c + (hit.Point - c) * 0.82f ) - px.Uv;
		var behind = px.Depth > hit.Far ? Scene.Color.Sample( px.Uv + bend * 0.35f ).Rgb : col;
		var front = ShellColour( hit.Point );
		var back = ShellColour( eye + px.ViewDir * hit.Far );
		float backSeen = px.Depth > hit.Far ? 1 : 0;
		// the design's lacquer: 35% opaque in front, the far side's colours tint what is behind it too
		var lit = Lighting.Standard( new Surface( hit.Point, n, front, 0.05f, 0.15f, Vector3.Zero ) ).Rgb;
		var glass = Vector3.Lerp( behind * Vector3.Lerp( Vector3.One, back * 1.2f + Vector3.One * 0.1f, 0.35f * backSeen ), lit, 0.35f );
		// sky reflection and the sun's glint
		var refl = Vector3.Reflect( px.ViewDir, n );
		glass += Render.Background( refl ) * fresnel * 0.8f;
		float glint = MathF.Pow( MathF.Max( refl.Dot( Render.SunDirection ), 0 ), 900 );
		glass += Render.SunColor * glint * 6;
		// the rim reads as thicker glass
		glass = Vector3.Lerp( glass, glass * 0.75f + Vector3.One * 0.06f, MathX.SmoothStep( 0.35f, 0, facing ) * 0.65f );
		return new Color( glass.x, glass.y, glass.z, 1 );
	}

	// ---------------------------------------------------------------- the aim arrow, painted on the lane for the bowler
	[Draw( After = Stage.Lighting )]
	Color Arrow( in ScreenPixel px )
	{
		if ( !IsLocal || !LiningUp || px.Depth > 1e20f ) return px.Color;
		var p = px.WorldPosition;
		if ( MathF.Abs( p.z - Alley.H ) > 6 ) return px.Color;
		var ball = WorldPosition;
		float yaw = Step == StepLine ? 0 : (1 - 2 * (Step == StepAim ? Caret : Set[StepAim])) * MaxAimDegrees;
		var fwd = Rotation.FromYaw( yaw ).Forward;
		var lat = new Vector3( -fwd.y, fwd.x, 0 );
		float power = Step == StepPower ? Caret : Set[StepPower];
		float frac = Step >= StepPower ? 0.35f + 0.65f * power : 0.6f;
		float L = Radius * 14 * frac;
		float spin = Step == StepSpin ? 1 - 2 * Caret : 0;
		float bend = spin * L * 0.28f;
		var o = new Vector3( ball.x, ball.y, Alley.H ) + fwd * Radius * 4;
		var d = p - o;
		float s = d.Dot( fwd ) / L;
		if ( s < 0 || s > 1 ) return px.Color;
		float off = d.Dot( lat ) - bend * s * s;
		float half = s < 0.74f ? MathF.Max( 18, 0.05f * L ) : MathF.Max( 30, 0.12f * L ) * (1 - s) / 0.26f;
		float a = MathX.Clamp( (half - MathF.Abs( off )) / 4, 0, 1 );
		if ( a <= 0 ) return px.Color;
		var tint = Step == StepLine ? new Vector3( 0.3f, 0.9f, 1 ) : Step == StepAim ? new Vector3( 1, 0.85f, 0.2f )
			: Step == StepPower ? Vector3.Lerp( new Vector3( 0.3f, 1, 0.3f ), new Vector3( 1, 0.3f, 0.2f ), power ) : new Vector3( 0.75f, 0.45f, 1 );
		var col = Vector3.Lerp( px.Color.Rgb, tint * 1.6f, a * 0.85f );
		return new Color( col.x, col.y, col.z, 1 );
	}
}
