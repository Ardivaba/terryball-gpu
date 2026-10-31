/// <summary>
/// A player's Terry (the source's TerryAvatar with its PlayerController): one per player slot, walking the alley in
/// third person. The floor is the alley's own shape (Walk.FloorAt, from the landmarks the scene generator writes),
/// so walking needs no physics queries: a step higher than StepHeight is a wall. At a lane's LANE podium, E opens
/// the lane's lobby (keyboard driven: W/S to pick, Space/Enter to choose, E to close), which talks to the lane
/// through messages; Q is a quick game on the nearest idle lane. The crane scoops a bowler into the lane's ball
/// (Scoop) and sets them down on the settee (Drop); while carried the Terry walking here is hidden and the ball's
/// rider wears this bowler's colours.
/// </summary>
[Title( "Bowler" ), Category( "Terryball" ), Icon( "directions_walk" ), RenderOrder( 10 )]
public sealed class Bowler : Panel
{
	public const float WalkSpeed = 170, RunSpeed = 320, Gravity = 800, JumpSpeed = 300, StepHeight = 24, PodiumRange = 128;
	public const int Rows = 5;

	[Property, Owner, Range( 0, 15 )] public int Slot { get; set; }

	[State, Predicted( Tolerance = 64 )] public Vector3 Feet;
	[State, Predicted] public Vector3 Velocity;
	[State, Predicted] public float Yaw;
	[State, Predicted] public float Pitch;
	[State, Predicted] public bool Grounded;
	[State, Predicted] public int Menu = -1;     // the lane whose lobby is open
	[State, Predicted] public int MenuRow;
	[State] public bool Alive;
	[State] public bool Carried;
	[State] public int Joined = -1;             // the lane this bowler has joined
	[Local] Vector3 prevFeet;
	[Local] bool started;

	PlayerInput Input => Players.Input( Slot );
	public bool IsLocal => Slot == Players.Local;
	SkinnedModelRenderer Model => GetComponent<SkinnedModelRenderer>();
	Vector3 Parking => new Vector3( Alley.ConcourseX1 + 3000, Slot * 300, -3000 );

	/// <summary>The lane this player's HUD follows: the one joined, else the nearest by y.</summary>
	public int HudLane => Joined >= 0 ? Joined : Walk.NearestLane( Feet.y );

	protected override void OnStart()
	{
		Feet = WorldPosition;
		Yaw = 180;
		prevFeet = Feet;
	}

	[Message]
	public void Scoop()
	{
		Carried = true;
		Menu = -1;
		Velocity = Vector3.Zero;
	}

	[Message]
	public void Drop( Vector3 at )
	{
		Carried = false;
		Feet = at;
		Velocity = Vector3.Zero;
	}

	[Message]
	public void SetJoined( int lane ) { Joined = lane; }

	protected override void OnFixedUpdate()
	{
		float dt = Time.Delta;
		var input = Input;
		if ( !Networking.IsClient ) Alive = input.Connected || Slot == 0;
		if ( !Alive ) { GameObject.Visible = false; WorldPosition = Parking; Joined = -1; Carried = false; Menu = -1; return; }
		GameObject.Visible = !Carried;
		if ( Carried ) { WorldPosition = Parking; return; }
		if ( !IsLocal ) Look( input.LookDelta );

		if ( Menu >= 0 ) MenuInput( input );
		else
		{
			int near = NearPodium();
			if ( near >= 0 && input.Pressed( "Use" ) ) { Menu = near; MenuRow = 0; }
			if ( input.KeyPressed( Keys.Q ) ) QuickGame();
		}

		// walking: camera-relative, eased toward the wish; a frozen walker while the lobby is open
		var move = Menu >= 0 ? Vector3.Zero : input.AnalogMove;
		var wish = Rotation.FromYaw( Yaw ) * move.WithZ( 0 ) * (input.Down( "Run" ) ? RunSpeed : WalkSpeed);
		var horiz = Vector3.Lerp( Velocity.WithZ( 0 ), wish, 1 - MathF.Exp( -(Grounded ? 12 : 2) * dt ) );
		float vz = Velocity.z - Gravity * dt;
		if ( Grounded && Menu < 0 && input.Pressed( "Jump" ) ) vz = JumpSpeed;
		prevFeet = Feet;
		var next = Feet;
		// slide: try the move, then each axis on its own; a rise above StepHeight is a wall
		var step = horiz * dt;
		if ( Walk.FloorAt( next + step ) <= Feet.z + StepHeight ) next += step;
		else if ( Walk.FloorAt( next + new Vector3( step.x, 0, 0 ) ) <= Feet.z + StepHeight ) { next.x += step.x; horiz.y = 0; }
		else if ( Walk.FloorAt( next + new Vector3( 0, step.y, 0 ) ) <= Feet.z + StepHeight ) { next.y += step.y; horiz.x = 0; }
		else horiz = Vector3.Zero;
		next.z += vz * dt;
		float floor = Walk.FloorAt( next );
		Grounded = false;
		if ( next.z <= floor + 0.5f && vz <= 0 )
		{
			// walking down a slope keeps the feet on it
			next.z = floor;
			vz = 0;
			Grounded = true;
		}
		if ( next.z < -2000 ) next = new Vector3( 28074, Slot * 20, 8 );   // fell out of the world: back to the concourse
		Feet = next;
		Velocity = new Vector3( horiz.x, horiz.y, vz );
		WorldPosition = Feet;
		WorldRotation = Rotation.FromYaw( Yaw );
		Animate( dt );
	}

	void Animate( float dt )
	{
		var model = Model;
		var local = Rotation.FromYaw( Yaw ).Inverse * Velocity.WithZ( 0 );
		float speed = local.Length;
		if ( !Grounded && Velocity.z > 0 ) model.Play( "jump_loop", 1, true, 0.25f );
		else if ( !Grounded ) model.Play( "fall", 1, true, 0.25f );
		else if ( speed < 12 ) model.Play( "idle", 1, true, 0.25f );
		else if ( speed > WalkSpeed * 1.3f ) model.Play( Anim.EightWay( "run", local ), Math.Clamp( speed / 240, 0.6f, 1.8f ), true, 0.2f );
		else model.Play( Anim.EightWay( "walk", local ), Math.Clamp( speed / 90, 0.6f, 1.8f ), true, 0.2f );
	}

	void Look( Angles d )
	{
		Yaw += d.yaw;
		Pitch = MathX.Clamp( Pitch + d.pitch, -80, 80 );
	}

	/// <summary>The lane whose LANE podium is in reach, or -1.</summary>
	public int NearPodium()
	{
		for ( int i = 0; i < Alley.Lanes; i++ )
		{
			var p = new Vector3( Alley.PodiumX, Alley.LaneY[i] - 142.4f, Alley.SetteeFloor );
			if ( (Feet - p).Length < PodiumRange ) return i;
		}
		return -1;
	}

	Lane LaneAt( int index )
	{
		foreach ( var lane in Scene.All<Lane>() ) if ( lane.Index == index ) return lane;
		return Scene.First<Lane>();
	}

	/// <summary>Q: join the nearest idle lane (or the one already joined) and start it, the crane off for speed.</summary>
	void QuickGame()
	{
		int target = Joined >= 0 ? Joined : Walk.NearestLane( Feet.y );
		var lane = LaneAt( target );
		if ( lane.Playing ) return;
		if ( Joined != target ) { lane.Join( Slot ); Joined = target; }
		lane.Begin( Slot );
	}

	void MenuInput( PlayerInput input )
	{
		var lane = LaneAt( Menu );
		if ( input.Pressed( "Use" ) || input.KeyPressed( Keys.Escape ) || NearPodium() != Menu ) { Menu = -1; return; }
		if ( input.Pressed( "Forward" ) || input.KeyPressed( Keys.Up ) ) MenuRow = (MenuRow + Rows - 1) % Rows;
		if ( input.Pressed( "Backward" ) || input.KeyPressed( Keys.Down ) ) MenuRow = (MenuRow + 1) % Rows;
		if ( !(input.Pressed( "Jump" ) || input.KeyPressed( Keys.Enter ) || input.Pressed( "Attack1" )) ) return;
		if ( MenuRow == 0 && !lane.Playing )
		{
			if ( Joined == Menu ) { lane.Leave( Slot ); Joined = -1; }
			else
			{
				if ( Joined >= 0 ) LaneAt( Joined ).Leave( Slot );
				lane.Join( Slot );
				Joined = Menu;
			}
		}
		if ( MenuRow == 1 ) lane.ToggleAim( Slot );
		if ( MenuRow == 2 ) lane.ToggleCrane( Slot );
		if ( MenuRow == 3 ) { if ( lane.Playing ) lane.Halt( Slot ); else lane.Begin( Slot ); }
		if ( MenuRow == 4 && lane.Playing ) lane.Restart( Slot );
	}

	/// <summary>Third person over the shoulder while walking (the ball's camera takes over when carried).</summary>
	protected override void OnUpdate()
	{
		if ( !IsLocal || !Alive || Carried ) return;
		if ( Menu < 0 ) Look( Input.LookDelta );
		var feet = Vector3.Lerp( prevFeet, Feet, Time.TickAlpha );
		var rot = Rotation.From( Pitch, Yaw, 0 );
		var eye = feet + Vector3.Up * 64 - rot.Forward * 140 + rot.Right * 18 + Vector3.Up * 8;
		Camera.Set( eye, rot, 80, 2, 60000 );
	}

	// ---------------------------------------------------------------- Terry's colours and the lobby on screen
	[Draw]
	VertexOutput Wear( in SkinnedVertex v )
	{
		var o = Render.Project( v.Position );
		o.Uv = new Vector2( (v.Position - WorldPosition).Dot( WorldRotation.Up ), Terry.Part( v.Index ) );
		return o;
	}

	[Draw]
	Color Skin( in Surface s ) => Lighting.Standard( Terry.Dress( s, s.Uv.y, s.Uv.x, Slot ) );

	[Draw( After = Stage.Lighting )]
	Color Lobby( in ScreenPixel px )
	{
		if ( !IsLocal || !Alive || Carried ) return px.Color;
		var res = px.Pixel / new Vector2( MathF.Max( px.Uv.x, 1e-5f ), MathF.Max( px.Uv.y, 1e-5f ) );
		float scale = res.y / 1080;
		var q = new Vector2( px.Pixel.x, res.y - px.Pixel.y ) / scale;
		float W = res.x / scale;
		var d = ToDisplay( px.Color.Rgb );
		var start = d;
		if ( Menu >= 0 ) d = MenuPanel( q - new Vector2( W / 2 - 220, 300 ), d );
		else
		{
			int near = NearPodium();
			if ( near >= 0 ) d = Prompt( q - new Vector2( W / 2, 1080 - 140 ), d, Label.OpenLane, near + 1, 69 );
			else if ( Joined < 0 ) d = Prompt( q - new Vector2( W / 2, 1080 - 60 ), d, Label.QuickGame, -1, 81 );
		}
		if ( (d - start).Length < 1e-6f ) return px.Color;
		var o = FromDisplay( d );
		return new Color( o.x, o.y, o.z, 1 );
	}

	static Vector3 Over( Vector3 d, Vector3 c, float a ) => Vector3.Lerp( d, c, MathX.Clamp( a, 0, 1 ) );

	Vector3 Prompt( Vector2 q, Vector3 d, int label, int number, int key )
	{
		if ( MathF.Abs( q.x ) > 300 || q.y < -30 || q.y > 30 ) return d;
		float w = LabelWidth( label ) * 16 + (number > 0 ? NumberWidth( number ) * 16 + 8 : 0) + 60;
		d = Over( d, Vector3.Zero, 0.45f * Fill( Rect( q, -w / 2, -20, w, 40, 8 ) ) );
		d = Over( d, Vector3.Zero, 0.6f * Fill( Rect( q, -w / 2 + 8, -13, 26, 26, 5 ) ) );
		d = Over( d, Vector3.One, 0.5f * Outline( Rect( q, -w / 2 + 8, -13, 26, 26, 5 ), 1 ) );
		d = Over( d, Vector3.One, Char( q - new Vector2( -w / 2 + 21, 6 ), 15, key, 0.3f ) );
		d = Over( d, Vector3.One, Text( q - new Vector2( -w / 2 + 44, 6 ), 16, label, 0.2f ) );
		if ( number > 0 ) d = Over( d, Vector3.One, Number( q - new Vector2( -w / 2 + 44 + LabelWidth( label ) * 16 + 8, 6 ), 16, number, 0.2f ) );
		return d;
	}

	/// <summary>The lobby (the source's LaneControls): JOIN/LEAVE, throw mode, crane, START/STOP, RESET, the roster.</summary>
	Vector3 MenuPanel( Vector2 q, Vector3 d )
	{
		if ( q.x < -4 || q.x > 444 || q.y < -4 || q.y > 444 ) return d;
		var lane = LaneAt( Menu );
		d = Over( d, Vector3.Zero, 0.62f * Fill( Rect( q, 0, 0, 440, 440, 14 ) ) );
		d = Over( d, Css( 90, 150, 220 ), 0.55f * Outline( Rect( q, 0, 0, 440, 440, 14 ), 3 ) );
		var white = Vector3.One;
		var gold = Css( 241, 196, 15 );
		var blue = Css( 90, 160, 230 );
		d = Over( d, white, Text( q - new Vector2( 24, 46 ), 26, Label.Lane, 0.5f ) );
		d = Over( d, blue, Number( q - new Vector2( 24 + LabelWidth( Label.Lane ) * 26 + 10, 46 ), 26, Menu + 1, 0.5f ) );
		int status = lane.Playing ? (lane.GameOver ? Label.GameOver : Label.InPlay) : Label.Lobby;
		d = Over( d, gold, TextRight( q - new Vector2( 416, 44 ), 14, status, 0.3f ) );
		for ( int r = 0; r < Rows; r++ )
		{
			float y = 70 + r * 46;
			bool on = r == MenuRow;
			bool enabled = r == 0 ? !lane.Playing : r == 4 ? lane.Playing : true;
			if ( on ) d = Over( d, gold, 0.2f * Fill( Rect( q, 16, y, 408, 40, 8 ) ) );
			if ( on ) d = Over( d, gold, Outline( Rect( q, 16, y, 408, 40, 8 ), 1.5f ) );
			var ink = enabled ? white : white * 0.35f;
			int label = r == 0 ? (Joined == Menu ? Label.Leave : Label.Join) : r == 1 ? Label.ThrowMode : r == 2 ? Label.Crane
				: r == 3 ? (lane.Playing ? Label.Stop : Label.Start) : Label.Reset;
			d = Over( d, ink, Text( q - new Vector2( 34, y + 27 ), 17, label, 0.3f ) );
			if ( r == 1 ) d = Over( d, blue, TextRight( q - new Vector2( 406, y + 27 ), 17, lane.AimMode ? Label.Aim : Label.Free, 0.3f ) );
			if ( r == 2 ) d = Over( d, blue, TextRight( q - new Vector2( 406, y + 27 ), 17, lane.CraneEnabled ? Label.On : Label.Off, 0.3f ) );
		}
		// who has joined
		float ry = 70 + Rows * 46 + 26;
		d = Over( d, white * 0.6f, Text( q - new Vector2( 24, ry ), 12, Label.Joined, 0 ) );
		float x = 24 + LabelWidth( Label.Joined ) * 12 + 12;
		for ( int s = 0; s < 16; s++ )
		{
			if ( (lane.JoinedBits >> s & 1) == 0 ) continue;
			d = Over( d, s == Slot ? gold : white, Text( q - new Vector2( x, ry ), 13, Label.Player, 0.2f ) );
			d = Over( d, s == Slot ? gold : white, Number( q - new Vector2( x + Advance( 80 ) * 13 + 1, ry ), 13, s + 1, 0.2f ) );
			x += 44;
		}
		d = Over( d, white * 0.55f, TextCentred( q - new Vector2( 220, 425 ), 11, Label.MenuHint, 0 ) );
		return d;
	}
}

/// <summary>The alley's walkable floor: its height at a point (s&box units), from the generated landmarks.</summary>
public static class Walk
{
	public static int NearestLane( float y )
	{
		int best = 0;
		for ( int i = 1; i < Alley.Lanes; i++ ) if ( MathF.Abs( y - Alley.LaneY[i] ) < MathF.Abs( y - Alley.LaneY[best] ) ) best = i;
		return best;
	}

	public static float FloorAt( Vector3 p )
	{
		float x = p.x;
		if ( x >= Alley.ConcourseX0 && x <= Alley.ConcourseX1 && MathF.Abs( p.y ) <= Alley.ConcourseHalf ) return Alley.ConcourseZ;
		int i = NearestLane( p.y );
		float y = MathF.Abs( p.y - Alley.LaneY[i] );
		// the ramp from the concourse up to the settee
		if ( x > Alley.BackboardX && x < Alley.ConcourseX0 && y <= Alley.RampHalf )
			return Alley.SetteeZ * (Alley.ConcourseX0 - x) / (Alley.ConcourseX0 - Alley.BackboardX);
		if ( y > Alley.PlatformHalf ) return 0;
		if ( x >= Alley.PitEndX && x <= Alley.BackboardX ) return y <= Alley.SetteeHalf ? Alley.SetteeFloor : Alley.SetteeZ;
		if ( x > Alley.DeckEndX && x < Alley.PitEndX ) return y <= Alley.GutterOut ? 0 : y <= Alley.BarrierOut ? Alley.BarrierTop : Alley.H;
		if ( x >= Alley.FoulX && x <= Alley.DeckEndX )
			return y <= Alley.LaneHalf ? Alley.H : y <= Alley.GutterOut ? Alley.GutterFloor : y <= Alley.BarrierOut ? Alley.BarrierTop : Alley.H;
		if ( x >= Alley.ApproachX && x < Alley.FoulX ) return Alley.H;
		if ( x >= Alley.RampX0 && x < Alley.ApproachX ) return Alley.H * (x - Alley.RampX0) / (Alley.ApproachX - Alley.RampX0);
		return 0;
	}
}
