/// <summary>
/// A bowling pin: a dynamic compound-hull body at lane scale (15 real inches tall). Its lane's director judges it and
/// sends it Sweep (fade out where it fell, then park) and RackTo (glide onto its spot, then back to physics with its
/// batch). S&GPU can't switch a body's type at run time, so a racking or parked pin is placed every tick with
/// SetTransform, zero velocity and a collision filter that meets nothing.
/// </summary>
[Title( "Pin" ), Category( "Terryball" ), Icon( "sports_bar" )]
public sealed class Pin : GpuComponent
{
	public const int Up = 0, Down = 1, Racking = 2, Parked = 3;
	public const float FadeOutSeconds = 0.35f, RackSeconds = 0.5f;
	public const float TiltThresholdDegrees = 30, DisplacementThresholdInches = 4;

	[Property, Range( 1, 10 )] public int Number { get; set; } = 1;
	[Property] public Lane Lane { get; set; }
	/// <summary>The pin's spot (world, base on the deck).</summary>
	[Property] public Vector3 Home { get; set; }

	[State] public int Phase;
	[State] public float Age;              // seconds in this phase
	[State] public Vector3 FromPos;
	[State] public Rotation FromRot;
	[State] public float Delay;            // racking: when this pin starts to glide
	[State] public float ReleaseAt;        // racking: when the batch goes back to physics
	[State] public bool FadeIn;            // racking: the pin was hidden, so it fades in on the way

	uint Category => 2u << Lane.Index;
	Vector3 Parking => new Vector3( Home.x, Home.y, -4000 - Number * 400 );

	protected override void OnStart()
	{
		Phase = Up;
		FromRot = Rotation.Identity;
	}

	/// <summary>Down by the source's rule: tipped past 30 degrees, or 4 real inches off its spot.</summary>
	public bool Fallen
	{
		get
		{
			if ( Phase == Down || Phase == Parked ) return true;
			if ( Phase == Racking ) return false;
			var off = (WorldPosition - Home).WithZ( 0 );
			float maxOff = DisplacementThresholdInches * Alley.U;
			return WorldRotation.Up.z < 0.8660254f || off.Length > maxOff;
		}
	}

	/// <summary>Still enough for the watch to end (swept and racking pins don't count).</summary>
	public bool Still => Phase != Up || Rigidbody.Velocity.Length <= 25 && Rigidbody.AngularVelocity.Length <= 1;

	/// <summary>How visible the pin is (sweep fade out, rack fade in).</summary>
	public float Alpha
	{
		get
		{
			if ( Phase == Parked ) return 0;
			if ( Phase == Down ) return 1 - MathX.Clamp( Age / FadeOutSeconds, 0, 1 );
			if ( Phase == Racking && FadeIn ) return MathX.Clamp( (Age - Delay) / RackSeconds, 0, 1 );
			return 1;
		}
	}

	/// <summary>Puts the pin (its GameObject: the base) at pos/rot.</summary>
	void Place( Vector3 pos, Rotation rot ) => Rigidbody.SetTransform( pos, rot );

	[Message]
	public void Sweep()
	{
		if ( Phase == Parked ) return;
		Phase = Down;
		Age = 0;
	}

	/// <summary>Back onto the spot: instantly (a fresh game), or gliding after `delay` and released at `releaseAt`.</summary>
	[Message]
	public void RackTo( bool instant, float delay, float releaseAt )
	{
		Age = 0;
		if ( instant )
		{
			Phase = Up;
			Place( Home, Rotation.Identity );
			Rigidbody.SetVelocity( Vector3.Zero, Vector3.Zero );
			Rigidbody.SetCollisionFilter( Category, 1u | Category );
			return;
		}
		FadeIn = Phase == Parked || Phase == Down;
		FromPos = FadeIn ? Home + Vector3.Up * Alley.PinHeight * 0.6f : WorldPosition;
		FromRot = FadeIn ? Rotation.Identity : WorldRotation;
		Delay = delay;
		ReleaseAt = MathF.Max( releaseAt, delay + RackSeconds );
		Phase = Racking;
	}

	[Local] float lastClack = -100;
	[Local] public Vector3 Seen;   // where the pin is (diagnostics: --dump-components)
	[Local] public float SeenUp;
	[Local] public Vector3 SeenBody;
	[Local] public Rotation SeenBodyRot;

	/// <summary>
	/// Pin sounds (PinImpactAudio) from the physics step's contacts: a thud when the ball hits the pin, a clack for a
	/// pin hitting a pin, a softer knock off the deck, gutters and walls; louder and brighter the faster they met.
	/// </summary>
	protected override void OnCollisionStart( Collision c )
	{
		float speed = c.Contact.NormalSpeed;
		// quiet while racking, for PinRackQuietSeconds after the batch goes live, and between hits of one pin
		if ( Phase != Up || Age < 0.5f || Time.Now - lastClack < 0.06f || speed < 300 ) return;
		var other = c.Other.GameObject;
		bool byBall = other.Get<Ball>().IsValid();
		bool byPin = other.Get<Pin>().IsValid();
		float loud = MathX.Clamp( speed / 3000, 0.12f, 1 ) * Ball.Hearing( WorldPosition, 12000 );
		if ( loud < 0.02f ) return;
		float bright = MathX.Clamp( speed / 6000, 0, 0.12f );
		if ( byBall ) Sound.Play2D( Sounds.Thud + Number % 2, loud * 0.7f, 0.95f + bright );
		else if ( byPin ) Sound.Play2D( Sounds.Clack + Random.Int( Number * 7919 + Time.Tick, 0, 6 ), loud * 0.55f, 0.92f + 0.016f * Number + bright );
		else Sound.Play2D( Sounds.Clack + (Number % 6), loud * 0.3f, 0.75f + bright );
		lastClack = Time.Now;
	}

	protected override void OnFixedUpdate()
	{
		Age += Time.Delta;
		Seen = WorldPosition;
		SeenUp = WorldRotation.Up.z;
		SeenBody = Rigidbody.Position;
		SeenBodyRot = Rigidbody.Rotation;
		if ( Phase == Down && Age >= FadeOutSeconds ) { Phase = Parked; Age = 0; }
		if ( Phase == Parked )
		{
			Rigidbody.SetCollisionFilter( Category, 0 );
			Place( Parking, Rotation.Identity );
			Rigidbody.SetVelocity( Vector3.Zero, Vector3.Zero );
		}
		else if ( Phase == Racking )
		{
			float t = MathX.SmoothStep( 0, 1, MathX.Clamp( (Age - Delay) / RackSeconds, 0, 1 ) );
			if ( Age >= ReleaseAt )
			{
				Phase = Up;
				Age = 0;
				Place( Home, Rotation.Identity );
				Rigidbody.SetCollisionFilter( Category, 1u | Category );
			}
			else
			{
				// one filter command per body per tick (commands in one tick are applied in no set order)
				Rigidbody.SetCollisionFilter( Category, 0 );
				Place( Vector3.Lerp( FromPos, Home, t ), Rotation.Slerp( FromRot, Rotation.Identity, t ) );
			}
			Rigidbody.SetVelocity( Vector3.Zero, Vector3.Zero );
		}
	}

	/// <summary>White lacquer, two red neck stripes; a dissolve while it fades out or in.</summary>
	[Draw]
	Color Paint( in Surface s )
	{
		float a = Alpha;
		if ( a < 1 )
		{
			var q = s.Position * 0.37f;
			float n = MathX.Fract( MathF.Sin( MathF.Floor( q.x ) * 12.9898f + MathF.Floor( q.y ) * 78.233f + MathF.Floor( q.z ) * 37.719f ) * 43758.547f );
			if ( n > a ) Render.Discard();
		}
		float t = 1 - s.Uv.y;   // height up the pin, 0..1 (the OBJ's v is flipped on load)
		bool stripe = t > 0.69f && t < 0.73f || t > 0.78f && t < 0.82f;
		var albedo = stripe ? new Vector3( 0.78f, 0.07f, 0.09f ) : new Vector3( 0.95f, 0.95f, 0.95f );
		return Lighting.Standard( s with { Albedo = albedo, Roughness = 0.28f } );
	}
}
