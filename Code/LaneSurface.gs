/// <summary>
/// The lane bed's markings, painted per pixel over the wood (the source builds them as tinted decal boxes): the 39
/// boards in alternating tints, the red foul line, the cyan throw line and the seven targeting arrows.
/// </summary>
[Title( "Lane Surface" ), Category( "Terryball" ), Icon( "texture" )]
public sealed class LaneSurface : GpuComponent
{
	const float FoulWidth = 47.06f, LineHalfLength = 705.88f;
	const float ArrowLength = 141.18f, ArrowHalfBase = 47.06f;
	const float ArrowX0 = 10294.79f, ArrowStepX = 282.35f, ArrowStepY = 125.19f;

	[Draw]
	Color Paint( in Surface s )
	{
		var p = s.Position;
		// the nearest lane's centre line
		float ly = Alley.LaneY[0];
		for ( int i = 1; i < 4; i++ ) if ( MathF.Abs( p.y - Alley.LaneY[i] ) < MathF.Abs( p.y - ly ) ) ly = Alley.LaneY[i];
		float y = p.y - ly;
		var albedo = s.Albedo;
		if ( s.Normal.z > 0.5f && p.x > Alley.FoulX - FoulWidth )
		{
			// boards: 39 across the lane, alternating tints (even boards from the +y edge are the light ones)
			float bw = 2 * Alley.LaneHalf / 39;
			int b = (int)MathF.Floor( (Alley.LaneHalf - y) / bw );
			var tint = (b & 1) == 0 ? new Vector3( 1, 0.98f, 0.94f ) : new Vector3( 0.86f, 0.8f, 0.71f );
			// a fine dark seam between boards
			float edge = MathF.Abs( MathX.Fract( (Alley.LaneHalf - y) / bw ) - 0.5f ) * 2;
			tint *= 1 - 0.25f * MathX.SmoothStep( 0.9f, 1, edge );
			albedo *= tint;
			// the arrows: board 20 at the front, then 15/25, 10/30, 5/35 a step behind and out
			for ( int k = 0; k < 4; k++ )
			{
				float ax = ArrowX0 - k * ArrowStepX;
				for ( int side = -1; side <= 1; side += 2 )
				{
					if ( k == 0 && side > 0 ) continue;
					float ay = side * k * ArrowStepY;
					float u = (p.x - ax) / ArrowLength;
					float w = MathF.Abs( y - ay ) / ArrowHalfBase;
					if ( u >= 0 && u <= 1 && w <= 1 - u ) albedo = new Vector3( 0.2f, 0.13f, 0.07f ) * 0.8f;
				}
			}
		}
		if ( s.Normal.z > 0.5f && MathF.Abs( y ) < LineHalfLength )
		{
			if ( MathF.Abs( p.x - Alley.FoulX ) < FoulWidth / 2 ) albedo = new Vector3( 0.85f, 0.1f, 0.1f ) * 0.8f;
			if ( MathF.Abs( p.x - Alley.ThrowX ) < FoulWidth / 2 ) albedo = new Vector3( 0.1f, 0.85f, 0.95f ) * 0.8f;
		}
		return Lighting.Standard( s with { Albedo = albedo } );
	}
}
