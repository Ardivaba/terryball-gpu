/// <summary>
/// The Pin Singularity: a demo effect on key 3 (the host's). A black hole is born from the nearest ball and hangs
/// over the lane; sixteen thousand real physics pins pour out of the sky, fall into orbit and grind round it as a
/// glowing accretion disk; the alley's floor bends up towards it and the picture lenses round it with an Einstein
/// ring. After ten seconds (or 3 again) it collapses and blows everything out with a shock wave, the pins rain down
/// and fade, and the alley's own pins are set back on their spots.
///
/// Everything below runs off ONE function, <see cref="Well"/>: the hole's gravitational potential at a point.
/// The physics pulls each body down its gradient and orbits it at the speed that gradient allows (Graviton.gs,
/// inside the GPU solver); the alley's vertex shader bends the ground by it (Warp); the screen lens deflects light
/// by it, α = 4Φ/c² (Lens); and the sound reads it at the listener (OnAudio). All of it on the GPU, from the same
/// fields and the same physics buffer, with nothing read back or copied to the CPU.
///
/// The lanes pause while it runs (Lane.OnFixedUpdate asks <see cref="Holds"/>); scoring and turns resume after.
/// </summary>
[Title( "Pin Singularity" ), Category( "Terryball" ), Icon( "blur_on" ), RenderOrder( -5 ), Include( "singularity.glsl" )]
public sealed class Singularity : GpuComponent
{
	// ---------------------------------------------------------------- the timeline (seconds after the key)
	public const float RainFrom = 0.25f, RainFor = 2.4f;
	public const float CollapseAt = 9.5f, ReleaseAt = 10.1f, FadeAt = 13.6f, RespotAt = 14.4f, EndAt = 15.6f;
	// ---------------------------------------------------------------- the hole (s&box units: inches, seconds)
	public const float GM = 3.0e10f;            // G·M at full mass (in³/s²): orbits at 1500 in take about 2 s
	public const float C = 18000;               // the alley's speed of light (in/s): r_s = 2GM/c² ≈ 270 in at full mass
	public const float Soft = 140;              // softening of the centre (in)
	public const float HoverHeight = 950;      // above the lane top
	public const float HoverAhead = 6500;       // in front of the camera
	public const float Tilt = 30;               // the disk's tilt towards the camera (degrees)
	public const float ShockSpeed = 16000, ShockWidth = 900, ShockPotential = 1.4e8f;
	public const float SagScale = 52000;        // potential (in²/s²) per inch of the ground's bend

	[Property] public ModelRenderer HideLanebed { get; set; }
	[Property] public ModelRenderer HideApproach { get; set; }
	[Property] public ModelRenderer HideGutter { get; set; }
	[Property] public ModelRenderer HidePit { get; set; }
	[Property] public ModelRenderer HideCarpet { get; set; }
	[Property] public ModelRenderer HideMetal { get; set; }
	[Property] public ModelRenderer HideFloor { get; set; }
	[Property, Filter( "mipmap" )] public Texture LaneWood { get; set; } = "textures/lanewood_color.png";
	[Property, Filter( "mipmap" )] public Texture ApproachWood { get; set; } = "textures/approachwood_color.png";
	[Property, Filter( "mipmap" )] public Texture GutterTex { get; set; } = "textures/gutter_color.png";
	[Property, Filter( "mipmap" )] public Texture PitTex { get; set; } = "textures/pit_color.png";
	[Property, Filter( "mipmap" )] public Texture CarpetTex { get; set; } = "textures/floordark_color.png";
	[Property, Filter( "mipmap" )] public Texture MetalTex { get; set; } = "textures/metal_color.png";
	[Property, Filter( "mipmap" )] public Texture FloorTex { get; set; } = "textures/floor_color.png";

	[State] public bool Active;
	[State] public float Age;               // seconds since the key
	[State] public Vector3 Birth;           // where it was born (the nearest ball)
	[State] public Vector3 Hover;           // where it hangs
	[State] public Vector3 Axis;            // the disk's normal
	[State] public int UpLow, UpHigh;       // the alley's pins standing when it began (bit lane * 10 + number - 1)
	[State] public bool Respotted;
	[State] public float DiskSpin;          // the pins' mean angular speed round the hole (rad/s), from the physics
	[State] public float DiskPins;          // how many pins are in the disk

	[Local] bool shownActive = true;

	/// <summary>True while the lanes should wait (Lane.OnFixedUpdate).</summary>
	public static bool Holds()
	{
		foreach ( var s in Scene.All<Singularity>() ) if ( s.Active ) return true;
		return false;
	}

	// ---------------------------------------------------------------- the one function
	/// <summary>How heavy the hole is at time t (0..1, more while it collapses, none after the release).</summary>
	public static float MassAt( float t )
	{
		if ( t >= ReleaseAt ) return 0;
		float grow = MathX.SmoothStep( 0, 2.6f, t );
		float squeeze = MathX.SmoothStep( CollapseAt, ReleaseAt, t );
		return grow * (1 + 1.6f * squeeze * squeeze);
	}

	/// <summary>Where the hole is at time t: it rises from the ball to its hover point.</summary>
	public Vector3 CentreAt( float t ) => Vector3.Lerp( Birth, Hover, MathX.SmoothStep( 0, 1.6f, t ) );

	/// <summary>
	/// THE function: the hole's gravitational potential at p (in²/s², negative near it), for a hole at c of relative
	/// mass m, `since` seconds after the release (negative before): a softened point mass, and after the release the
	/// shock wave, a ridge of potential running outwards at ShockSpeed. The pins fall down its gradient (Graviton,
	/// in the solver), the ground bends by it (Warp), light bends by it (Lens), the drone hears it (OnAudio).
	/// </summary>
	public static float WellAt( Vector3 p, Vector3 c, float m, float since )
	{
		float r = (p - c).Length;
		float well = -GM * m / MathF.Sqrt( r * r + Soft * Soft );
		if ( since > 0 )
		{
			float x = (r - ShockSpeed * since) / ShockWidth;
			// a ridge with a ringing trough behind it, fading as it spreads
			float ring = MathF.Exp( -x * x ) * (1 + 0.5f * MathF.Sin( x * 5 )) - 0.35f * MathF.Exp( -(x + 1.6f) * (x + 1.6f) );
			well += ShockPotential * ring * MathF.Exp( -0.55f * since ) * MathX.SmoothStep( 0, 300, r );
		}
		return well;
	}

	/// <summary>The pull at p: minus WellAt's gradient (central differences of the same function).</summary>
	public static Vector3 PullAt( Vector3 p, Vector3 c, float m, float since )
	{
		const float e = 6;
		return -new Vector3( WellAt( p + Vector3.Forward * e, c, m, since ) - WellAt( p - Vector3.Forward * e, c, m, since ),
			WellAt( p + Vector3.Left * e, c, m, since ) - WellAt( p - Vector3.Left * e, c, m, since ),
			WellAt( p + Vector3.Up * e, c, m, since ) - WellAt( p - Vector3.Up * e, c, m, since ) ) / (2 * e);
	}

	/// <summary>This hole's Well at p, `later` seconds from now.</summary>
	public float Well( Vector3 p, float later )
	{
		if ( !Active ) return 0;
		float t = Age + later;
		return WellAt( p, CentreAt( t ), MassAt( t ), t - ReleaseAt );
	}

	public Vector3 Pull( Vector3 p, float later )
	{
		float t = Age + later;
		return PullAt( p, CentreAt( t ), MassAt( t ), t - ReleaseAt );
	}

	/// <summary>Schwarzschild radius at time t: 2GM/c².</summary>
	public float HorizonAt( float t ) => 2 * GM * MassAt( t ) / (C * C);

	/// <summary>When the frame shows things: between the last two ticks, as the renderer blends the bodies.</summary>
	static float Shown => (Time.TickAlpha - 1) * Time.FixedDelta;

	// ---------------------------------------------------------------- the timeline
	protected override void OnFixedUpdate()
	{
		bool host = !Networking.IsClient;
		if ( host && Players.Input( 0 ).KeyPressed( 51 ) )   // the 3 key
		{
			if ( !Active ) Begin();
			else if ( Age < CollapseAt ) Age = CollapseAt;     // 3 again: collapse now
		}
		if ( !Active ) return;
		Age += Time.Delta;
		// the disk's spin, measured by the workers from the bodies' own velocities
		float spin = 0, n = 0;
		foreach ( var g in Scene.All<Graviton>() ) { spin += g.SpinSum; n += g.SpinCount; }
		DiskSpin = n > 0 ? spin / n : 0;
		DiskPins = n;
		if ( host && !Respotted && Age >= RespotAt ) Respot();
		if ( Age >= EndAt ) Active = false;
	}

	void Begin()
	{
		var eye = Camera.Main.WorldPosition;
		var ahead = Camera.Main.WorldRotation.Forward.WithZ( 0 ).Normal;
		Hover = eye + ahead * HoverAhead;
		Hover = Hover.WithZ( Alley.H + HoverHeight );
		Birth = Hover;
		float best = 3500;
		foreach ( var b in Scene.All<Ball>() )
		{
			float d = (b.WorldPosition - eye).Length;
			if ( d < best ) { best = d; Birth = b.WorldPosition; }
		}
		float a = Tilt * MathF.PI / 180;
		Axis = (Vector3.Up * MathF.Cos( a ) - ahead * MathF.Sin( a )).Normal;
		UpLow = 0;
		UpHigh = 0;
		foreach ( var pin in Scene.All<Pin>() )
		{
			if ( pin.Phase != Pin.Up && pin.Phase != Pin.Racking ) continue;
			int bit = pin.Lane.Index * 10 + pin.Number - 1;
			if ( bit < 30 ) UpLow |= 1 << bit; else UpHigh |= 1 << (bit - 30);
		}
		Age = 0;
		Respotted = false;
		DiskSpin = 0;
		Active = true;
	}

	/// <summary>The alley's own pins: the ones standing before go back to their spots, the rest stay swept.</summary>
	void Respot()
	{
		Respotted = true;
		foreach ( var pin in Scene.All<Pin>() )
		{
			int bit = pin.Lane.Index * 10 + pin.Number - 1;
			bool up = bit < 30 ? (UpLow >> bit & 1) != 0 : (UpHigh >> (bit - 30) & 1) != 0;
			if ( up ) pin.RackTo( false, (10 - pin.Number) * 0.05f, 0.45f + Pin.RackSeconds );
			else pin.Sweep();
		}
	}

	protected override void OnUpdate()
	{
		// while it runs, the bent copy of the ground is drawn instead of the flat one
		bool on = Active && Age < EndAt - 0.05f;
		if ( on == shownActive ) return;
		shownActive = on;
		SetVisible( GameObject, on );
		HideLanebed.Visible = !on;
		HideApproach.Visible = !on;
		HideGutter.Visible = !on;
		HidePit.Visible = !on;
		HideCarpet.Visible = !on;
		HideMetal.Visible = !on;
		HideFloor.Visible = !on;
	}

	[Glsl( "sgSetEntityVisible({0}, {1})" )] static void SetVisible( GameObject e, bool visible ) { }

	// ---------------------------------------------------------------- the bent ground (models/sg_warp.obj)
	/// <summary>Where the ground at p is drawn: pulled towards the hole by the Well, never past it.</summary>
	Vector3 Bent( Vector3 p, float later )
	{
		var c = CentreAt( Age + later );
		var to = c - p;
		float d = to.Length;
		float pull = -Well( p, later ) / SagScale;
		pull = pull > 0 ? MathF.Min( pull, d * 0.62f ) : MathF.Max( pull, -0.25f * d - 40 );
		return p + to / MathF.Max( d, 1 ) * pull;
	}

	[Draw]
	VertexOutput Warp( in Vertex v )
	{
		var p = v.Position;
		var t1 = MathF.Abs( v.Normal.z ) > 0.7f ? Vector3.Forward : Vector3.Up;
		var t2 = v.Normal.Cross( t1 ).Normal;
		t1 = t2.Cross( v.Normal );
		var b0 = Bent( p, Shown );
		var n = (Bent( p + t1 * 20, Shown ) - b0).Cross( Bent( p + t2 * 20, Shown ) - b0 );
		n = n.Normal * MathF.Sign( n.Dot( v.Normal ) );
		var o = Render.Project( b0, n );
		o.Uv = v.Uv;
		return o;
	}

	[Draw]
	Color Ground( in Surface s )
	{
		int part = (int)MathF.Floor( (s.Uv.x + 2048) / 4096 );
		var uv = new Vector2( s.Uv.x - 4096 * part, s.Uv.y );
		Vector3 albedo;
		float rough = 0.55f, metal = 0;
		if ( part == 0 ) { albedo = LaneWood.Sample( uv ).Rgb * Boards( s.Position, s.Normal ); rough = 0.2f; }
		else if ( part == 1 ) albedo = ApproachWood.Sample( uv ).Rgb;
		else if ( part == 2 ) { albedo = GutterTex.Sample( uv ).Rgb; rough = 0.33f; metal = 0.15f; }
		else if ( part == 3 ) { albedo = PitTex.Sample( uv ).Rgb; rough = 0.85f; }
		else if ( part == 4 ) { albedo = CarpetTex.Sample( uv ).Rgb; rough = 0.9f; }
		else if ( part == 5 ) { albedo = MetalTex.Sample( uv ).Rgb; rough = 0.38f; metal = 0.75f; }
		else albedo = FloorTex.Sample( uv ).Rgb;
		albedo = new Vector3( MathF.Pow( albedo.x, 2.2f ), MathF.Pow( albedo.y, 2.2f ), MathF.Pow( albedo.z, 2.2f ) );   // the textures are sRGB
		// the textbook picture of curved space: a grid over the ground, glowing as deep as the Well is
		float depth = MathX.Clamp( -Well( s.Position, Shown ) / (GM / 900), 0, 1 );
		float shock = MathX.Clamp( Well( s.Position, Shown ) / ShockPotential, 0, 1 );
		var g = new Vector2( MathX.Fract( uv.x * 1.25f ), MathX.Fract( uv.y * 1.25f ) );
		float line = MathF.Max( 1 - MathX.SmoothStep( 0, 0.06f, MathF.Min( g.x, 1 - g.x ) ), 1 - MathX.SmoothStep( 0, 0.06f, MathF.Min( g.y, 1 - g.y ) ) );
		var glow = new Vector3( 0.25f, 0.6f, 1.6f ) * line * depth * depth * 3 + new Vector3( 3, 1.4f, 0.5f ) * shock * (0.4f + line);
		return Lighting.Standard( new Surface( s.Position, s.Normal, albedo, rough, metal, glow ) );
	}

	/// <summary>The lane bed's boards (LaneSurface's tints) for the bent copy.</summary>
	static Vector3 Boards( Vector3 p, Vector3 n )
	{
		if ( n.z < 0.5f || p.x < Alley.FoulX ) return Vector3.One;
		float ly = Alley.LaneY[0];
		for ( int i = 1; i < 4; i++ ) if ( MathF.Abs( p.y - Alley.LaneY[i] ) < MathF.Abs( p.y - ly ) ) ly = Alley.LaneY[i];
		float bw = 2 * Alley.LaneHalf / 39, y = Alley.LaneHalf - (p.y - ly);
		int b = (int)MathF.Floor( y / bw );
		var tint = (b & 1) == 0 ? new Vector3( 1, 0.98f, 0.94f ) : new Vector3( 0.86f, 0.8f, 0.71f );
		float edge = MathF.Abs( MathX.Fract( y / bw ) - 0.5f ) * 2;
		return tint * (1 - 0.25f * MathX.SmoothStep( 0.9f, 1, edge ));
	}

	// ---------------------------------------------------------------- the lens
	/// <summary>A blackbody-ish ramp: deep red, orange, yellow-white, blue-white.</summary>
	static Vector3 Hot( float k )
	{
		k = MathX.Clamp( k, 0, 1.4f );
		var a = Vector3.Lerp( new Vector3( 0.6f, 0.05f, 0.01f ), new Vector3( 1.6f, 0.55f, 0.12f ), MathX.Clamp( k * 2, 0, 1 ) );
		var b = Vector3.Lerp( a, new Vector3( 1.7f, 1.4f, 1.0f ), MathX.Clamp( k * 2 - 1, 0, 1 ) );
		return Vector3.Lerp( b, new Vector3( 1.1f, 1.3f, 2.0f ), MathX.Clamp( (k - 1) * 2.5f, 0, 1 ) );
	}

	/// <summary>The hot gas at the disk's inner edge where a ray segment crosses it: Doppler-beamed by its orbit.</summary>
	Vector3 Gas( Vector3 from, Vector3 dir, float maxT, Vector3 c, float rs, float t )
	{
		float den = dir.Dot( Axis );
		if ( MathF.Abs( den ) < 1e-4f ) return Vector3.Zero;
		float s = (c - from).Dot( Axis ) / den;
		if ( s <= 0 || s > maxT ) return Vector3.Zero;
		var q = from + dir * s - c;
		float r = q.Length, rin = 3 * rs, rout = rin * 4.2f;
		if ( r < rin || r > rout ) return Vector3.Zero;
		// orbital speed from the Well's own gradient: v² / r = |pull|
		var radial = q / r;
		float v = MathF.Sqrt( MathF.Max( -Pull( c + q, 0 ).Dot( -radial ), 0 ) * r );
		var tangent = Axis.Cross( radial );
		float beta = MathX.Clamp( v / C, 0, 0.9f );
		float doppler = 1 / ((1 - beta * tangent.Dot( -dir )) * MathF.Sqrt( 1 / (1 - beta * beta) ));
		float x = (r - rin) / (rout - rin);
		float ang = MathF.Atan2( q.Dot( Axis.Cross( Vector3.Forward ).Normal ), q.Dot( Axis.Cross( Axis.Cross( Vector3.Forward ).Normal ) ) );
		float swirl = 0.65f + 0.35f * MathF.Sin( ang * 3 + MathF.Log( r ) * 9 - t * 9 ) * MathF.Sin( ang * 7 - MathF.Log( r ) * 14 - t * 13 );
		float edge = MathX.SmoothStep( 0, 0.08f, x ) * (1 - MathX.SmoothStep( 0.55f, 1, x ));
		return Hot( 1.2f * (1 - x) * doppler ) * (2.2f * doppler * doppler * doppler * edge * swirl * (1 - 0.6f * x));
	}

	[Draw( After = Stage.Lighting )]
	Color Lens( in ScreenPixel px )
	{
		if ( !Active ) return px.Color;
		float t = Age + Shown;
		var eye = Render.CameraPosition;
		var d = px.ViewDir;
		var c = CentreAt( t );
		float rs = HorizonAt( t );
		float tc = (c - eye).Dot( d );
		var col = px.Color.Rgb;
		if ( tc > 0 )
		{
			var P = eye + d * tc;
			var toward = c - P;
			float b = toward.Length;
			toward /= MathF.Max( b, 1e-3f );
			// light bends by the same Well the pins fall in: α = 4Φ/c² at the ray's closest approach
			float alpha = MathX.Clamp( -4 * Well( P, Shown ) / (C * C), -0.25f, 2.6f );
			bool behind = px.Depth > tc - 2 * rs - 200;
			float shadow = 2.6f * rs;
			if ( behind )
			{
				var bent = (d * MathF.Cos( alpha ) + toward * MathF.Sin( alpha )).Normal;
				var uv = Render.WorldToScreen( eye + bent * 1000 );
				float back = Scene.Color.Depth( uv );
				// only what lies beyond the hole is lensed; something in front of it stays put
				if ( back > tc - 400 || alpha < 0 ) col = Scene.Color.Sample( uv ).Rgb;
				if ( b < shadow ) col = Vector3.Zero;
				// the photon ring
				col += Hot( 1.1f ) * MathF.Exp( -MathF.Pow( (b - shadow) / (0.07f * shadow + 4), 2 ) ) * 6 * MathX.Clamp( rs / 60, 0, 1 );
				// the gas at the inner edge, seen straight and over the top of the hole by the bent ray
				col += Gas( eye, d, MathF.Min( tc, px.Depth ), c, rs, t ) * (b < shadow ? 0 : 1);
				col += Gas( P, bent, 1e5f, c, rs, t ) * (b < shadow ? 0 : 1);
			}
			else col += Gas( eye, d, px.Depth, c, rs, t );
		}
		// glow round the hot disk, and the release's flash
		float on = MathX.SmoothStep( 0, 1, Age ) * (1 - MathX.SmoothStep( FadeAt, EndAt, Age ));
		col += Scene.Color.SampleBlur( px.Uv, 14 ).Rgb * 0.05f * on;
		float since = t - ReleaseAt;
		if ( since > 0 )
		{
			// the release: a white-hot core where the hole was, and a short flash over everything
			var toHole = (CentreAt( t ) - eye).Normal;
			float off = MathF.Acos( MathX.Clamp( toHole.Dot( d ), -1, 1 ) );
			col += Hot( 1.3f ) * (8 * MathF.Exp( -off * off / 0.004f ) * MathF.Exp( -since * 5 ) + 0.12f * MathF.Exp( -since * 20 ));
		}
		else if ( since > -0.6f ) col *= 1 - 0.7f * MathX.SmoothStep( -0.6f, 0, since );
		return new Color( col.x, col.y, col.z, px.Color.a );
	}

	// ---------------------------------------------------------------- the sound
	protected override Vector2 OnAudio( float t )
	{
		if ( !Active ) return Vector2.Zero;
		var ear = Audio.ListenerPosition;
		var c = CentreAt( Age );
		// the drone: pitched by the disk's real angular speed, as loud as the Well is deep where you stand
		float deep = MathX.Clamp( -Well( ear, 0 ) / (GM / 2500), 0, 1.5f );
		float f = 34 + 16 * DiskSpin;
		float drone = MathF.Sin( MathF.Tau * Audio.Oscillator( 0, f ) ) + 0.5f * MathF.Sin( MathF.Tau * Audio.Oscillator( 1, f * 2.003f ) )
			+ 0.3f * MathF.Sin( MathF.Tau * Audio.Oscillator( 2, f * 3.01f ) );
		float m = MassAt( Age );
		var sound = Audio.At( c, drone * 0.12f * MathF.Min( m, 1.6f ) * (0.5f + 0.5f * deep), 30000 );
		// the release: a falling bass hit, and a second one when the shock wave's ridge passes the listener
		float since = Age - ReleaseAt;
		if ( since > 0 && since < 6 )
		{
			float sweep = 26 + 60 * MathF.Exp( -since * 3 );
			float boom = MathF.Sin( MathF.Tau * Audio.Oscillator( 3, sweep ) ) * MathF.Exp( -since * 1.3f );
			float ridge = MathX.Clamp( Well( ear, 0 ) / ShockPotential, 0, 1 );
			sound += Vector2.One * (boom * (0.5f + 0.4f * ridge) + Audio.Noise() * (MathF.Exp( -since * 9 ) * 0.3f + ridge * 0.15f));
		}
		return sound;
	}
}
