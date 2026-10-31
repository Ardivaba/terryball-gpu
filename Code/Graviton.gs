/// <summary>
/// One worker of the Pin Singularity (Singularity.gs): it owns Pins rain pins (rain pin k = physics body
/// BodyBase + k, drawn by GPU instance pool slot k) and does their work in parallel with the other workers:
/// spawning them over the alley, pulling them round the hole inside the physics solver, their glow, their sound.
/// Its own body is a static speck far under the floor; it exists so the worker gets an OnPhysicsStep.
/// </summary>
[Title( "Graviton" ), Category( "Terryball" ), Icon( "scatter_plot" ), Include( "singularity.glsl" )]
public sealed class Graviton : GpuComponent
{
	public const int Pins = 32;
	public const int BodyBase = 1024;            // SGS_BODY_BASE (singularity.glsl): rain pin k is body BodyBase + k
	public const float PinRadius = 26, PinHalfSegment = 71, PinMass = 0.4f, PinScale = 0.55f;
	public const float WorldGravity = 9084.7f;   // project.json's gravity in s&box units (in/s²)

	[Property] public int Index { get; set; }

	[State] public int Spawned;             // this worker's pins spawned so far
	[State] public int Ghosts;              // bit j: pin j passes through things (from the collapse until it is thrown clear)
	[Local] public float SpinSum;           // Σ angular speed round the hole of the pins in the disk
	[Local] public float SpinCount;
	[Local] public int Near = -1;           // the body of this worker's pin nearest the listener (OnAudio)
	[Local] public float NearLoud;
	[Local] public Vector3 NearAt;
	[Local] public float Crackle;           // hits this tick (sudden losses of speed), for OnAudio
	[Local, Size( Pins )] float[] lastSpeed;
	[Local, Size( 8 )] uint[] heat;
	[Local] uint pinMesh = 0xFFFFFFFF;

	Singularity Hole => Scene.First<Singularity>();
	int First => Index * Pins;

	/// <summary>lowbias32: an integer hash, the same on every GPU (no sin hashes for gameplay).</summary>
	static uint Hash( uint x )
	{
		x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; x ^= x >> 16;
		return x;
	}
	static uint Hash( int a, int b ) => Hash( (uint)a * 0x9e3779b9u ^ Hash( (uint)b ) );
	static uint Hash( uint a, int b ) => Hash( a * 0x9e3779b9u ^ Hash( (uint)b ) );
	static float Unit( uint h ) => (h >> 8) / 16777216f;
	static Vector3 Ball( uint h ) => new Vector3( Unit( Hash( h ) ), Unit( Hash( h + 1 ) ), Unit( Hash( h + 2 ) ) ) * 2 - Vector3.One;

	[Glsl( "({0})" )] static Rigidbody BodyAt( int index ) => default;
	[Glsl( "int(sgBodyShape({0}))" )] static int Shape( Rigidbody body ) => 0;

	protected override void OnFixedUpdate()
	{
		var h = Hole;
		if ( !h.IsValid() ) return;
		bool host = !Networking.IsClient;
		if ( !h.Active || h.Age >= Singularity.EndAt - 0.2f )
		{
			if ( Spawned > 0 ) Clear( host );
			return;
		}
		if ( host ) { Rain( h ); Ghost( h ); }
		// once they have shrunk away, a few pins a tick go (thousands of destroys in one tick cost a frame)
		if ( h.Age >= Singularity.FadeAt + 1.25f )
		{
			for ( int n = 0; n < 4 && Spawned > 0; n++ )
			{
				Spawned--;
				if ( host ) Sg.sgsDestroyPin( (uint)(First + Spawned) );
				Sg.sgsHidePin( (uint)(First + Spawned) );
			}
			return;
		}
		Listen( h );
	}

	/// <summary>Spawn the pins whose moment has come: spread over RainFor seconds, scattered over the sky round the hole.</summary>
	void Rain( Singularity h )
	{
		for ( int n = 0; n < 8 && Spawned < Pins; n++ )
		{
			int j = Spawned;
			uint seed = Hash( Index * Pins + j, 7919 );
			float at = Singularity.RainFrom + Singularity.RainFor * (j + 0.8f * Unit( seed )) / Pins;
			if ( h.Age < at ) break;
			int k = First + j;
			float a = Unit( Hash( seed, 1 ) ) * MathF.Tau;
			float r = 700 + 4600 * MathF.Sqrt( Unit( Hash( seed, 2 ) ) );
			var pos = h.Hover + new Vector3( MathF.Cos( a ) * r, MathF.Sin( a ) * r, 0 );
			pos = pos.WithZ( Alley.H + 4600 + 4200 * Unit( Hash( seed, 3 ) ) );
			var rot = Rotation.FromAxis( Ball( Hash( seed, 4 ) ).Normal, Unit( Hash( seed, 5 ) ) * 360 );
			var vel = new Vector3( 0, 0, -2500 ) + Ball( Hash( seed, 6 ) ) * 600;
			var spin = Ball( Hash( seed, 7 ) ) * 6;
			Sg.sgsSpawnPin( (uint)k, pos, rot, PinRadius, PinHalfSegment, PinMass, vel, spin, Sg.sgsInstance( (uint)k ) );
			if ( pinMesh == 0xFFFFFFFF ) Gather();
			Sg.sgsShowPin( (uint)k, pinMesh, heat[0], pos, rot );
			lastSpeed[j] = vel.Length;
			Spawned++;
		}
	}

	/// <summary>
	/// The collapse squeezes every pin into the hole: there they pass through each other (a ghost filter), and each
	/// becomes solid again once the release has thrown it clear. (Thousands of pins in one point would cost the solver
	/// more than a frame.)
	/// </summary>
	void Ghost( Singularity h )
	{
		if ( h.Age >= Singularity.CollapseAt - 0.15f && h.Age < Singularity.ReleaseAt && Ghosts == 0 && Spawned > 0 )
		{
			for ( int j = 0; j < Spawned; j++ ) Sg.sgsSolidPin( (uint)(First + j), false );
			Ghosts = Spawned >= 32 ? -1 : (1 << Spawned) - 1;
			return;
		}
		if ( h.Age < Singularity.ReleaseAt + 0.12f || Ghosts == 0 ) return;
		var c = h.CentreAt( h.Age );
		for ( int j = 0; j < Spawned; j++ )
		{
			if ( (Ghosts >> j & 1) == 0 ) continue;
			if ( (BodyAt( BodyBase + First + j ).Position - c).Length < 2600 && h.Age < Singularity.ReleaseAt + 1.5f ) continue;
			Sg.sgsSolidPin( (uint)(First + j), true );
			Ghosts &= ~(1 << j);
		}
	}

	/// <summary>The rain pin mesh and the heat materials ride on Gravitons 0..7: look up their GPU indices.</summary>
	void Gather()
	{
		foreach ( var g in Scene.All<Graviton>() )
		{
			if ( g.Index >= 8 ) continue;
			heat[g.Index] = Sg.sgsMaterialOf( g.GameObject );
			if ( g.Index == 0 ) pinMesh = Sg.sgsMeshOf( g.GameObject );
		}
	}

	void Clear( bool host )
	{
		for ( int j = 0; j < Spawned; j++ )
		{
			if ( host ) Sg.sgsDestroyPin( (uint)(First + j) );
			Sg.sgsHidePin( (uint)(First + j) );
		}
		Spawned = 0;
		Ghosts = 0;
		Near = -1;
		NearLoud = 0;
		Crackle = 0;
		SpinSum = 0;
		SpinCount = 0;
	}

	/// <summary>What the sound and the drone need, from the bodies themselves: the pin nearest the ear, hits, the disk's spin.</summary>
	void Listen( Singularity h )
	{
		var ear = Camera.Main.WorldPosition;
		var c = h.CentreAt( h.Age );
		float best = 1e9f, hits = 0, spin = 0, count = 0;
		int near = -1;
		for ( int j = 0; j < Spawned; j++ )
		{
			var b = BodyAt( BodyBase + First + j );
			var p = b.Position;
			var v = b.Velocity;
			float speed = v.Length;
			float lost = lastSpeed[j] - speed;
			if ( lost > 2500 ) hits += MathF.Min( lost / 6000, 1 );   // a real knock, not the disk steering
			lastSpeed[j] = speed;
			var q = p - c;
			float r = q.Length;
			if ( r < 6000 && r > 1 )
			{
				spin += q.Cross( v ).Dot( h.Axis ) / (r * r);
				count++;
			}
			float d = (p - ear).Length;
			if ( d < best ) { best = d; near = j; }
		}
		Near = near < 0 ? -1 : BodyBase + First + near;
		if ( near >= 0 )
		{
			var nb = BodyAt( Near );
			NearAt = nb.Position;
			float close = 1 / (1 + best * best / (900 * 900));
			NearLoud = MathX.Clamp( nb.Velocity.Length / 6000, 0, 1.5f ) * close * close;   // a pass-by: loud only up close
		}
		Crackle = MathX.Lerp( Crackle, hits, 0.5f );
		SpinSum = spin;
		SpinCount = count;
	}

	/// <summary>
	/// Inside the solver, every substep: each pin of this worker falls down the hole's Well (Singularity.Well, the
	/// same function the ground, the lens and the sound use) and is steered towards the circular orbit that the
	/// Well's own gradient allows, flattened onto the disk. Worker k also pulls the alley's own pins (body i < BodyBase,
	/// i % workers == k); the balls drive their own bodies and are left alone.
	/// </summary>
	protected override void OnPhysicsStep()
	{
		var h = Hole;
		if ( !h.IsValid() || !h.Active ) return;
		float dt = PhysicsStep.Delta;
		float t = h.Age;
		var c = h.CentreAt( t );
		var axis = h.Axis;
		// the hole's state, read once: every body then evaluates the same Singularity.WellAt the ground, lens and sound use
		float mass = Singularity.MassAt( t ), since = t - Singularity.ReleaseAt;
		float grip = t < Singularity.ReleaseAt ? MathX.SmoothStep( 0.3f, 2.2f, t ) : 0;
		float inflow = t < Singularity.CollapseAt ? 40 : 4200 * MathX.SmoothStep( Singularity.CollapseAt, Singularity.ReleaseAt, t );
		int count = PhysicsStep.BodyCount;
		for ( int j = 0; j < Spawned; j++ )
		{
			int i = BodyBase + First + j;
			if ( i >= count ) break;
			Steer( PhysicsStep.Body( i ), c, mass, since, axis, grip, inflow, dt );
		}
		int workers = (int)Scene.Count<Graviton>();
		for ( int i = Index; i < BodyBase && i < count; i += workers )
		{
			var b = PhysicsStep.Body( i );
			if ( !b.IsDynamic || Shape( b.Rigidbody ) == 0 ) continue;   // spheres are the balls
			Steer( b, c, mass, since, axis, grip, inflow, dt );
		}
	}

	static void Steer( StepBody b, Vector3 c, float mass, float since, Vector3 axis, float grip, float inflow, float dt )
	{
		if ( !b.IsDynamic ) return;
		var p = b.Position;
		var v = b.Velocity;
		var accel = Singularity.PullAt( p, c, mass, since );
		var q = p - c;
		float r = q.Length;
		if ( grip > 0 && r > 1 )
		{
			// the disk: the circular speed the pull allows here (v² / r = |pull|), in the disk's plane, a slow inflow
			float height = q.Dot( axis );
			var flat = q - axis * height;
			float rf = MathF.Max( flat.Length, 1 );
			var radial = flat / rf;
			float vc = MathF.Sqrt( MathF.Max( -accel.Dot( radial ), 0 ) * rf );
			// a thick disk: free within its half thickness (150 in + a quarter of the radius), drawn in beyond it
			float half = 90 + 0.1f * rf, over = MathF.Max( MathF.Abs( height ) - half, 0 ) * MathF.Sign( height );
			var want = axis.Cross( radial ) * vc + axis * (v.Dot( axis ) * 0.3f - over * 2.2f) - radial * inflow;
			float reach = 1 - MathX.SmoothStep( 4000, 7500, r );
			accel += (want - v) * (2.4f * grip * reach);
			// inside the hole's reach the alley's gravity gives way
			accel += Vector3.Up * WorldGravity * reach * grip;
		}
		b.Velocity = v + accel * dt;
	}

	protected override void OnUpdate()
	{
		var h = Hole;
		if ( !h.IsValid() || !h.Active || Spawned == 0 ) return;
		if ( pinMesh == 0xFFFFFFFF ) Gather();
		// fade: the pins shrink away after the shock wave has thrown them out
		float scale = 1 - MathX.SmoothStep( Singularity.FadeAt, Singularity.FadeAt + 1.2f, h.Age );
		var c = h.CentreAt( h.Age );
		for ( int j = 0; j < Spawned; j++ )
		{
			var b = BodyAt( BodyBase + First + j );
			float speed = b.Velocity.Length;
			float near = 1 - MathX.SmoothStep( 300, 2400, (b.Position - c).Length );
			float hot = MathX.Clamp( (speed - 1800) / 6000 + near * 0.55f, 0, 0.999f );
			Sg.sgsLookPin( (uint)(First + j), heat[(int)(hot * 8)], scale * PinScale );
		}
	}

	/// <summary>
	/// This worker's voice: its pin nearest the ear, read straight from the physics buffer every sample. A whoosh
	/// Doppler-shifted by the pin's real velocity along the line to the ear, and the crackle of this tick's hits.
	/// </summary>
	protected override Vector2 OnAudio( float t )
	{
		if ( Near < 0 || NearLoud < 0.002f && Crackle < 0.01f ) return Vector2.Zero;
		var body = BodyAt( Near );
		var ear = Audio.ListenerPosition;
		var p = body.Position;
		var to = ear - p;
		float d = MathF.Max( to.Length, 1 );
		float closing = body.Velocity.Dot( to / d );
		const float Sound = 13500;   // the speed of sound in s&box units (in/s)
		float doppler = MathX.Clamp( Sound / MathF.Max( Sound - closing, 2000 ), 0.4f, 3 );
		float f = (150 + 23 * (Index % 11)) * doppler;
		float tone = MathF.Sin( MathF.Tau * Audio.Oscillator( 0, f ) ) * 0.35f + MathF.Sin( MathF.Tau * Audio.Oscillator( 1, f * 1.51f ) ) * 0.2f;
		float hiss = Audio.Noise();
		float whoosh = (tone + hiss * 0.15f) * (0.7f + 0.3f * MathF.Sin( MathF.Tau * Audio.Oscillator( 2, 9 * doppler ) )) * NearLoud * 0.22f;
		float n = Audio.Noise();
		float crack = MathF.Abs( n ) > 1 - MathX.Clamp( Crackle * 0.0006f, 0, 0.0025f ) ? n * 0.3f : 0;
		return Audio.At( p, whoosh, 12000 ) + Audio.At( NearAt, crack, 16000 );
	}
}

/// <summary>The engine calls of singularity.glsl (Code/singularity.glsl).</summary>
[GlslBuiltins, Include( "singularity.glsl" )]
public static class Sg
{

	public static void sgsSpawnPin( uint k, Vector3 pos, Rotation rot, float radius, float halfHeight, float mass, Vector3 vel, Vector3 angVel, uint instance ) { }
	public static void sgsDestroyPin( uint k ) { }
	public static void sgsSolidPin( uint k, bool solid ) { }
	public static uint sgsInstance( uint k ) => 0;
	public static uint sgsMaterialOf( GameObject entity ) => 0;
	public static uint sgsMeshOf( GameObject entity ) => 0;
	public static void sgsShowPin( uint k, uint mesh, uint material, Vector3 pos, Rotation rot ) { }
	public static void sgsLookPin( uint k, uint material, float scale ) { }
	public static void sgsHidePin( uint k ) { }
}
