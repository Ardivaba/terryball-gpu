/// <summary>
/// Terry inside the ball (the s&box citizen at 1.5x): visual only, his pelvis on the ball's centre, facing where the
/// ball travels. He walks, then runs faster as the ball speeds up (walk to run up to RollAtMph); past it the source
/// plays the citizen's Roll move, which this export lacks, so he tucks up and tumbles with the ball instead.
/// </summary>
[Title( "Rider" ), Category( "Terryball" ), Icon( "accessibility_new" )]
public sealed class Rider : GpuComponent
{
	public const float Scale = 1.5f, Pelvis = 38;              // the citizen's pelvis height (inches) at scale 1
	public const float RollSpeed = 11.5f / Ball.UnitsToMph;     // RollAtMph
	public const float WalkRampStart = 0.3f, WalkRate = 0.5f, RunRate = 4.5f;

	[Property] public Ball Ball { get; set; }
	[Property] public Lane Lane { get; set; }

	[Local] Vector3 face = new Vector3( 1, 0, 0 );
	[Local] float tumble;          // degrees rolled while tumbling
	[Local] float tuck;            // 0 upright .. 1 tucked
	[Local] Vector3 last;

	SkinnedModelRenderer Model => GetComponent<SkinnedModelRenderer>();

	protected override void OnUpdate()
	{
		float dt = Time.Delta;
		var c = Ball.WorldPosition;
		var v = (c - last) / MathF.Max( dt, 1e-4f );
		last = c;
		var horiz = v.WithZ( 0 );
		float speed = horiz.Length;
		if ( speed > 5 && dt > 0 ) face = Vector3.Lerp( face, horiz.Normal, 1 - MathF.Exp( -10 * dt ) ).Normal;
		bool rolling = speed >= RollSpeed && Ball.Mode == Ball.Rolling;
		tuck = MathX.Lerp( tuck, rolling ? 1 : 0, 1 - MathF.Exp( -6 * dt ) );
		if ( rolling ) tumble += speed / Ball.Radius * dt * 57.29578f;
		else tumble = MathX.Lerp( tumble, MathF.Round( tumble / 360 ) * 360, 1 - MathF.Exp( -5 * dt ) );
		var upright = Rotation.LookAt( face );
		var lateral = Vector3.Up.Cross( face ).Normal;
		var rot = Rotation.FromAxis( lateral, tumble * tuck ) * upright;
		WorldRotation = rot;
		WorldPosition = c - rot.Up * Pelvis * Scale;

		var model = Model;
		model.Visible = Lane.Playing;
		float ramp = MathX.Clamp( speed / RollSpeed, 0, 1 );
		float walkT = MathX.Clamp( (ramp - WalkRampStart) / (1 - WalkRampStart), 0, 1 );
		if ( rolling ) model.Play( "jump_loop", 1, true, 0.3f );
		else if ( speed < 20 ) model.Play( "idle", 1, true, 0.3f );
		else if ( walkT < 0.35f ) model.Play( "walk_n", MathX.Lerp( WalkRate, 1.6f, ramp / 0.5f ), true, 0.25f );
		else model.Play( "run_n", MathX.Lerp( 1, RunRate, walkT ), true, 0.25f );
	}

	[Draw]
	VertexOutput Wear( in SkinnedVertex v )
	{
		var o = Render.Project( v.Position );
		o.Uv = new Vector2( (v.Position - WorldPosition).Dot( WorldRotation.Up ) / Scale, Terry.Part( v.Index ) );
		return o;
	}

	/// <summary>Terry's bowling outfit: a teal shirt, dark slacks, bowling shoes.</summary>
	[Draw]
	Color Skin( in Surface s )
	{
		int k = (int)(s.Uv.y + 0.5f);
		float h = s.Uv.x;
		var shirt = new Vector3( 0.05f, 0.42f, 0.45f );
		var slacks = new Vector3( 0.06f, 0.06f, 0.08f );
		var skin = new Vector3( 0.8f, 0.56f, 0.42f );
		if ( k == 0 || k == 2 )
		{
			// the shirt's two-tone panel and the slacks below the belt
			bool top = h > 38;
			var cloth = top ? Vector3.Lerp( shirt, new Vector3( 0.9f, 0.88f, 0.8f ), MathX.SmoothStep( 49, 50, h ) * (1 - MathX.SmoothStep( 53, 54, h )) ) : slacks;
			return Lighting.Standard( s with { Albedo = cloth, Roughness = 0.8f, Metalness = 0 } );
		}
		if ( k == 3 ) return Lighting.Standard( s with { Albedo = Vector3.Lerp( new Vector3( 0.55f, 0.08f, 0.06f ), new Vector3( 0.85f, 0.82f, 0.75f ), MathX.SmoothStep( 2.5f, 3, h ) ), Roughness = 0.45f, Metalness = 0 } );
		if ( k == 5 ) return Lighting.Standard( s with { Albedo = new Vector3( 0.02f, 0.02f, 0.025f ), Roughness = 0.08f, Metalness = 0 } );
		return Lighting.Standard( s with { Albedo = skin, Roughness = 0.6f, Metalness = 0 } );
	}
}

/// <summary>Which part of the citizen mesh a vertex is (its primitive in citizen.glb).</summary>
public static class Terry
{
	public static float Part( uint vertex ) =>
		vertex < 780 ? 0 : vertex < 2502 ? 1 : vertex < 3045 ? 2 : vertex < 3893 ? 3 : vertex < 6829 ? 4 : 5;
}
