/// <summary>
/// The drawing kit every HUD and display shares: text from the signed distance field font (textures/font.png,
/// Code/FontData.gs), the fixed labels (Code/Labels.gs), numbers, rounded boxes, and blending in display space.
/// Screen passes run in HDR before the tonemap, so the HUD converts the pixel to display (sRGB) colour, composites
/// there as a browser would, and converts back (the exact inverse of the ACES fit in the engine's composite).
/// </summary>
public abstract class Panel : GpuComponent
{
	[Property, Filter( "linear" )] public Texture Font { get; set; } = "textures/font.png";

	// ---------------------------------------------------------------- display space
	/// <summary>HDR linear (as the screen pass sees it) to the display's sRGB: the composite's ACES fit and encode.</summary>
	public static Vector3 ToDisplay( Vector3 x )
	{
		x = new Vector3( MathF.Max( x.x, 0 ), MathF.Max( x.y, 0 ), MathF.Max( x.z, 0 ) );
		var t = x * (x * 2.51f + Vector3.One * 0.03f) / (x * (x * 2.43f + Vector3.One * 0.59f) + Vector3.One * 0.14f);
		return new Vector3( Encode( MathX.Clamp( t.x, 0, 1 ) ), Encode( MathX.Clamp( t.y, 0, 1 ) ), Encode( MathX.Clamp( t.z, 0, 1 ) ) );
	}

	/// <summary>The display's sRGB back to the HDR value that tonemaps to it.</summary>
	public static Vector3 FromDisplay( Vector3 s ) => new Vector3( Untone( Decode( s.x ) ), Untone( Decode( s.y ) ), Untone( Decode( s.z ) ) );

	static float Encode( float c ) => c <= 0.0031308f ? c * 12.92f : 1.055f * MathF.Pow( c, 1 / 2.4f ) - 0.055f;
	static float Decode( float c ) => c <= 0.04045f ? c / 12.92f : MathF.Pow( (c + 0.055f) / 1.055f, 2.4f );
	static float Untone( float y )
	{
		y = MathX.Clamp( y, 0, 0.995f );
		float a = 2.51f - 2.43f * y, b = 0.03f - 0.59f * y, c = -0.14f * y;
		return (-b + MathF.Sqrt( MathF.Max( b * b - 4 * a * c, 0 ) )) / (2 * a);
	}

	/// <summary>A CSS-style colour (0..255 sRGB) as a display colour.</summary>
	public static Vector3 Css( float r, float g, float b ) => new Vector3( r, g, b ) / 255;

	// ---------------------------------------------------------------- shapes
	/// <summary>Signed distance (pixels) to a rounded box at centre c with half size h and corner radius r.</summary>
	public static float RoundBox( Vector2 p, Vector2 c, Vector2 h, float r )
	{
		var q = new Vector2( MathF.Abs( p.x - c.x ), MathF.Abs( p.y - c.y ) ) - h + new Vector2( r, r );
		var m = new Vector2( MathF.Max( q.x, 0 ), MathF.Max( q.y, 0 ) );
		return m.Length + MathF.Min( MathF.Max( q.x, q.y ), 0 ) - r;
	}

	/// <summary>A box from its top-left corner and size (screen layout: y down), signed distance in pixels.</summary>
	public static float Rect( Vector2 p, float x, float y, float w, float h, float r ) =>
		RoundBox( p, new Vector2( x + w / 2, y + h / 2 ), new Vector2( w / 2, h / 2 ), r );

	/// <summary>Coverage of a shape from its signed distance, antialiased over one pixel.</summary>
	public static float Fill( float d ) => MathX.Clamp( 0.5f - d, 0, 1 );

	/// <summary>Coverage of a ring (an outline) of width w along a shape's edge.</summary>
	public static float Outline( float d, float w ) => MathX.Clamp( 0.5f - (MathF.Abs( d + w / 2 ) - w / 2), 0, 1 );

	// ---------------------------------------------------------------- text
	/// <summary>A character of a label (0 past its end).</summary>
	public static int LabelChar( int label, int k )
	{
		if ( k < 0 || k >= 32 ) return 0;
		int w = Label.Words[label * 8 + k / 4];
		return (w >> (8 * (k % 4))) & 255;
	}

	public static float Advance( int ch ) => ch < 32 || ch > 126 ? 0 : FontData.Advance[ch - 32];

	/// <summary>A label's width in em.</summary>
	public static float LabelWidth( int label )
	{
		float w = 0;
		for ( int k = 0; k < 32; k++ )
		{
			int ch = LabelChar( label, k );
			if ( ch == 0 ) break;
			w += Advance( ch );
		}
		return w;
	}

	/// <summary>
	/// One glyph: p is the position in em from the glyph's pen point on the baseline (y up); aa is the distance
	/// field's antialiasing half width; grow widens the ink (strokes, bold).
	/// </summary>
	public float Glyph( int ch, Vector2 p, float aa, float grow )
	{
		if ( ch < 33 || ch > 126 ) return 0;
		int i = ch - 32;
		float adv = FontData.Advance[i];
		float cx = (p.x - adv * 0.5f) / FontData.CellEm + 0.5f;
		float cy = FontData.Baseline - p.y / FontData.CellEm;
		if ( cx < 0 || cx > 1 || cy < 0 || cy > 1 ) return 0;
		var uv = new Vector2( ((i % 16) + cx) / 16, ((i / 16) + cy) / 6 );
		float d = Font.SampleLod( uv, 0 ).r;
		return MathX.SmoothStep( 0.5f - grow - aa, 0.5f - grow + aa, d );
	}

	/// <summary>The distance field's antialiasing width for text of `size` pixels per em.</summary>
	public static float TextAa( float size ) => 0.7f * 3.125f / MathF.Max( size, 1 );

	/// <summary>
	/// A label's ink at q (pixels from the string's left end on the baseline, y down as the screen layout is),
	/// at `size` pixels per em; `stroke` pixels of extra ink round the letters (0 for plain text).
	/// </summary>
	public float Text( Vector2 q, float size, int label, float stroke )
	{
		var p = new Vector2( q.x, -q.y ) / size;
		if ( p.y < -0.45f || p.y > 1.15f || p.x < -0.3f ) return 0;
		float aa = TextAa( size ), grow = stroke * 3.125f / size;
		float pen = 0, ink = 0;
		for ( int k = 0; k < 32; k++ )
		{
			int ch = LabelChar( label, k );
			if ( ch == 0 || pen > p.x + 1 ) break;
			float adv = Advance( ch );
			if ( p.x > pen - 0.4f && p.x < pen + adv + 0.4f ) ink = MathF.Max( ink, Glyph( ch, new Vector2( p.x - pen, p.y ), aa, grow ) );
			pen += adv;
		}
		return ink;
	}

	/// <summary>A label centred on x = 0.</summary>
	public float TextCentred( Vector2 q, float size, int label, float stroke ) =>
		Text( q + new Vector2( LabelWidth( label ) * size * 0.5f, 0 ), size, label, stroke );

	/// <summary>A label ending at x = 0.</summary>
	public float TextRight( Vector2 q, float size, int label, float stroke ) =>
		Text( q + new Vector2( LabelWidth( label ) * size, 0 ), size, label, stroke );

	/// <summary>How many digits a non-negative number has.</summary>
	public static int Digits( int v )
	{
		int n = 1;
		for ( int k = 0; k < 9; k++ ) { if ( v < 10 ) break; v /= 10; n++; }
		return n;
	}

	/// <summary>A number's width in em.</summary>
	public static float NumberWidth( int v )
	{
		if ( v < 0 ) return 0;
		float w = 0;
		for ( int k = 0; k < 10; k++ ) { w += Advance( 48 + v % 10 ); v /= 10; if ( v == 0 ) break; }
		return w;
	}

	/// <summary>A non-negative number's ink, left end at x = 0 (nothing for negative values).</summary>
	public float Number( Vector2 q, float size, int v, float stroke )
	{
		if ( v < 0 ) return 0;
		var p = new Vector2( q.x, -q.y ) / size;
		if ( p.y < -0.45f || p.y > 1.15f ) return 0;
		float aa = TextAa( size ), grow = stroke * 3.125f / size;
		// digits right to left from the far end
		float pen = NumberWidth( v ), ink = 0;
		for ( int k = 0; k < 10; k++ )
		{
			int ch = 48 + v % 10;
			pen -= Advance( ch );
			if ( p.x > pen - 0.4f && p.x < pen + Advance( ch ) + 0.4f ) ink = MathF.Max( ink, Glyph( ch, new Vector2( p.x - pen, p.y ), aa, grow ) );
			v /= 10;
			if ( v == 0 ) break;
		}
		return ink;
	}

	public float NumberCentred( Vector2 q, float size, int v, float stroke ) => Number( q + new Vector2( NumberWidth( v ) * size * 0.5f, 0 ), size, v, stroke );
	public float NumberRight( Vector2 q, float size, int v, float stroke ) => Number( q + new Vector2( NumberWidth( v ) * size, 0 ), size, v, stroke );

	/// <summary>One character (an ASCII code) centred on x = 0.</summary>
	public float Char( Vector2 q, float size, int ch, float stroke )
	{
		var p = new Vector2( q.x, -q.y ) / size;
		return Glyph( ch, new Vector2( p.x + Advance( ch ) * 0.5f, p.y ), TextAa( size ), stroke * 3.125f / size );
	}
}
