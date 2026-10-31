/// <summary>
/// The lane's screen HUD for the local player, laid out at 1080p and scaled: the pin status card and throw speed
/// (top left), the scoreboard (top right), the aim meter (bottom centre), the call (centre), the key hints (bottom
/// left). Colours and sizes are the source's Razor panels'.
/// </summary>
public sealed partial class Lane
{
	// RackRows, top to bottom: the back row first (10 on the left), the head pin at the bottom
	static readonly int[] RackPins = { 10, 9, 8, 7, 6, 5, 4, 3, 2, 1 };
	static readonly int[] RowStart = { 0, 4, 7, 9 };
	static readonly int[] RowLen = { 4, 3, 2, 1 };

	bool ShowsHud => showHud;

	/// <summary>The lane's one screen pass: its world displays, then (for the local player's lane) the HUD over them.</summary>
	[Draw( After = Stage.Lighting )]
	Color Screen( in ScreenPixel px )
	{
		var d0 = ToDisplay( px.Color.Rgb );
		var shown = Displays( px, d0 );
		if ( !ShowsHud || Render.InView )
		{
			if ( (shown - d0).Length < 1e-6f ) return px.Color;
			var w = FromDisplay( shown );
			return new Color( w.x, w.y, w.z, 1 );
		}
		var res = px.Pixel / new Vector2( MathF.Max( px.Uv.x, 1e-5f ), MathF.Max( px.Uv.y, 1e-5f ) );
		float scale = res.y / 1080;
		// layout space: 1080 tall, y down from the top
		var q = new Vector2( px.Pixel.x, res.y - px.Pixel.y ) / scale;
		float W = res.x / scale;
		var d = shown;
		var start = d0;
		d = PinCard( q, d );
		d = Scoreboard( q - new Vector2( W - 24 - 648, 24 ), d );
		if ( Ball.LiningUp || Ball.Launched && Round == RoundRolling && AimMode ) d = AimMeter( q - new Vector2( W / 2 - 230, 1080 - 48 ), d );
		d = Callout( q - new Vector2( W / 2, 1080 * 0.36f ), d );
		d = Hints( q - new Vector2( 24, 1080 - 24 ), d );
		if ( (d - start).Length < 1e-6f ) return px.Color;
		var o = FromDisplay( d );
		return new Color( o.x, o.y, o.z, 1 );
	}

	static Vector3 Over( Vector3 d, Vector3 c, float a ) => Vector3.Lerp( d, c, MathX.Clamp( a, 0, 1 ) );

	/// <summary>A dark translucent card (rgba(0,0,0,.36), the source's backdrops).</summary>
	static Vector3 Card( Vector3 d, Vector2 q, float x, float y, float w, float h, float r ) =>
		Over( d, Vector3.Zero, 0.36f * Fill( Rect( q, x, y, w, h, r ) ) );

	// ---------------------------------------------------------------- pins and speed
	Vector3 PinCard( Vector2 q, Vector3 d )
	{
		if ( q.x > 260 || q.y > 330 ) return d;
		float x0 = 24, y0 = 24, w = 4 * 32 + 40;
		d = Card( d, q, x0, y0, w, 48 + 4 * 32 + 16, 10 );
		var white = Vector3.One;
		bool watching = Round == RoundWatching;
		d = Over( d, white, Text( q - new Vector2( x0 + 20, y0 + 16 + 18 ), 20, watching ? Label.Watching : Label.Pins, 0 ) );
		for ( int row = 0; row < 4; row++ )
		{
			float cy = y0 + 56 + row * 32 + 13;
			float rowW = RowLen[row] * 32;
			for ( int k = 0; k < 4; k++ )
			{
				if ( k >= RowLen[row] ) break;
				int n = RackPins[RowStart[row] + k];
				float cx = x0 + w / 2 - rowW / 2 + k * 32 + 16;
				bool down = (DownBits >> n & 1) != 0;
				float disc = Fill( (q - new Vector2( cx, cy )).Length - 13 );
				d = Over( d, down ? Css( 192, 57, 43 ) : Css( 46, 204, 113 ), disc );
				var ink = down ? Vector3.Lerp( Css( 192, 57, 43 ), white, 0.55f ) : Vector3.Zero;
				d = Over( d, ink, NumberCentred( q - new Vector2( cx, cy + 4.5f ), 12, n, 0 ) );
			}
		}
		// SPEED, latched at the throw line
		float sy = y0 + 48 + 4 * 32 + 16 + 10;
		d = Card( d, q, x0, sy, w, 76, 10 );
		d = Over( d, white * 0.7f, Text( q - new Vector2( x0 + 20, sy + 22 ), 12, Label.Speed, 0 ) );
		float mph = Ball.ThrowMph;
		var blue = Css( 111, 211, 255 );
		if ( mph > 0.05f )
		{
			int whole = (int)mph, tenth = (int)((mph - whole) * 10);
			var at = q - new Vector2( x0 + 20, sy + 62 );
			d = Over( d, blue, Number( at, 30, whole, 0.6f ) );
			float wx = NumberWidth( whole ) * 30;
			d = Over( d, blue, Char( at - new Vector2( wx + 5, 0 ), 30, 46, 0.6f ) );
			d = Over( d, blue, Number( at - new Vector2( wx + 11, 0 ), 30, tenth, 0.6f ) );
			d = Over( d, white * 0.7f, Text( at - new Vector2( wx + 11 + NumberWidth( tenth ) * 30 + 6, 0 ), 14, Label.Mph, 0 ) );
		}
		else d = Over( d, blue, Text( q - new Vector2( x0 + 20, sy + 62 ), 30, Label.Dash, 0.6f ) );
		return d;
	}

	// ---------------------------------------------------------------- the scoreboard
	Vector3 Scoreboard( Vector2 q, Vector3 d )
	{
		float w = 648, rowH = 64;
		float h = 14 + 26 + RosterCount * (rowH + 6) + 8;
		if ( q.x < -2 || q.y < -2 || q.x > w + 2 || q.y > h + 2 ) return d;
		d = Card( d, q, 0, 0, w, h, 10 );
		var white = Vector3.One;
		var gold = Css( 241, 196, 15 );
		d = Over( d, white, Text( q - new Vector2( 16, 14 + 18 ), 18, Label.Scoreboard, 0.3f ) );
		if ( GameOver ) d = Over( d, gold, TextRight( q - new Vector2( w - 16, 14 + 16 ), 13, Label.GameOver, 0.2f ) );
		else d = Over( d, white * 0.5f, TextRight( q - new Vector2( w - 16, 14 + 16 ), 11, Label.PressPReset, 0 ) );
		for ( int p = 0; p < MaxPlayers; p++ )
		{
			if ( p >= RosterCount ) break;
			float y = 14 + 30 + p * (rowH + 6);
			if ( q.y < y - 2 || q.y > y + rowH + 2 ) continue;
			bool up = p == Current && !GameOver;
			float fade = up || RosterCount == 1 ? 1 : 0.85f;
			// name
			d = Over( d, white * fade, Text( q - new Vector2( 16, y + 36 ), 13, Label.Player, 0.2f ) );
			d = Over( d, white * fade, Number( q - new Vector2( 16 + Advance( 80 ) * 13 + 1, y + 36 ), 13, Roster[p] + 1, 0.2f ) );
			float x = 16 + 78;
			for ( int f = 0; f < 10; f++ )
			{
				float cw = f == 9 ? 72 : 46;
				if ( q.x >= x - 1 && q.x < x + cw + 1 )
				{
					if ( up && f == Frame ) d = Over( d, gold, 0.18f * Fill( Rect( q, x, y, cw, rowH, 0 ) ) );
					d = Over( d, white, 0.18f * Fill( Rect( q, x, y, 1, rowH, 0 ) ) );
					d = Over( d, white * 0.4f, Number( q - new Vector2( x + 4, y + 10 ), 9, f + 1, 0 ) );
					int boxes = f == 9 ? 3 : 2;
					for ( int k = 0; k < 3; k++ )
					{
						if ( k >= boxes ) break;
						float bx = x + cw - 2 - (boxes - k) * 21, by = y + 13;
						float dist = Rect( q, bx, by, 20, 20, 0 );
						bool split = (SplitBits[p] >> Slot( f, k ) & 1) != 0 && RollOf( p, f, k ) >= 0;
						if ( split ) d = Over( d, gold, Outline( Rect( q, bx, by, 20, 20, 10 ), 2 ) );
						else d = Over( d, white, 0.14f * Outline( dist, 1 ) );
						int m = Mark( p, f, k );
						if ( m != 0 ) d = Over( d, white, Char( q - new Vector2( bx + 10, by + 15 ), 13, m, 0.35f ) );
					}
					int t = Total( p, f );
					if ( t >= 0 ) d = Over( d, white, NumberCentred( q - new Vector2( x + cw / 2, y + 56 ), 14, t, 0.3f ) );
				}
				x += cw;
			}
			// TOTAL
			if ( q.x >= x )
			{
				d = Over( d, white * 0.55f, TextCentred( q - new Vector2( x + 26, y + 14 ), 9, Label.Total, 0 ) );
				int best = 0;
				for ( int f = 0; f < 10; f++ ) if ( Total( p, f ) >= 0 ) best = Total( p, f );
				d = Over( d, white, NumberCentred( q - new Vector2( x + 26, y + 46 ), 20, best, 0.6f ) );
			}
		}
		return d;
	}

	// ---------------------------------------------------------------- the aim meter (ThrowAimHud)
	Vector3 AimMeter( Vector2 q, Vector3 d )
	{
		// bottom-anchored card, 460 wide; q is relative to its bottom-left corner
		float h = 150;
		if ( q.x < -12 || q.x > 472 || q.y > 12 || q.y < -h - 12 ) return d;
		var c = q + new Vector2( 0, h );   // top-left origin
		d = Card( d, c, 0, 0, 460, h, 12 );
		var white = Vector3.One;
		var accent = Css( 90, 200, 255 );
		int step = Ball.Step;
		bool thrown = step >= Ball.StepThrown;
		int shown = thrown ? Ball.StepSpin : step;
		int title = thrown ? Label.NiceThrow : Label.Line + step;
		d = Over( d, white, Text( c - new Vector2( 20, 12 + 16 ), 16, title, 0.4f ) );
		// ghost rows for the locked steps
		float y = 36;
		for ( int s = 0; s < 3; s++ )
		{
			if ( s >= shown ) break;
			float gy = y + s * 12;
			d = Over( d, white * 0.55f, Text( c - new Vector2( 20, gy + 8 ), 10, Label.Line + s, 0 ) );
			d = Over( d, Css( 46, 51, 64 ), 0.9f * Fill( Rect( c, 72, gy, 368, 7, 3.5f ) ) );
			d = Over( d, accent, Fill( Rect( c, 72 + Ball.SetOf( s ) * 368 - 2, gy, 4, 7, 1 ) ) );
		}
		y += shown * 12 + 4;
		// the live track
		float caret = thrown ? Ball.SetOf( Ball.StepSpin ) : Ball.Caret;
		d = Over( d, Css( 46, 51, 64 ), 0.95f * Fill( Rect( c, 20, y, 420, 16, 8 ) ) );
		if ( shown != Ball.StepPower ) d = Over( d, white, 0.28f * Fill( Rect( c, 20 + 210 - 1, y, 2, 16, 0 ) ) );
		if ( shown == Ball.StepPower ) d = Over( d, white, 0.9f * Fill( Rect( c, 20 + 420 * SweetSpotPower - 2, y, 4, 16, 0 ) ) );
		if ( shown == Ball.StepSpin )
		{
			d = Over( d, white, 0.9f * Fill( Rect( c, 20 + 420 * 0.1f - 2, y, 4, 16, 0 ) ) );
			d = Over( d, white, 0.9f * Fill( Rect( c, 20 + 420 * 0.9f - 2, y, 4, 16, 0 ) ) );
		}
		float cx = 20 + caret * 420;
		d = Over( d, accent, 0.35f * Fill( Rect( c, cx - 7, y - 4, 14, 24, 7 ) ) );
		d = Over( d, accent, Fill( Rect( c, cx - 3, y - 2, 6, 20, 3 ) ) );
		// pips
		for ( int s = 0; s < 4; s++ )
		{
			float pxl = 230 - 30 + s * 20;
			d = Over( d, s <= shown || thrown ? accent : Css( 70, 76, 92 ), Fill( (c - new Vector2( pxl, y + 30 )).Length - 4.5f ) );
		}
		// hints
		d = Over( d, white * 0.7f, TextCentred( c - new Vector2( 230, y + 56 ), 12, Label.ClickToSet, 0 ) );
		d = Over( d, white * 0.6f, TextCentred( c - new Vector2( 230, y + 74 ), 11, Label.StepBack, 0 ) );
		return d;
	}

	const float SweetSpotPower = 0.8f;

	// ---------------------------------------------------------------- the call
	Vector3 Callout( Vector2 q, Vector3 d )
	{
		if ( Call < 0 ) return d;
		float age = Clock - CallAt;
		if ( age < 0 || age > CallSeconds ) return d;
		if ( MathF.Abs( q.y ) > 160 || MathF.Abs( q.x ) > 900 ) return d;
		float a = MathX.Clamp( (CallSeconds - age) / CallFade, 0, 1 ) * MathX.SmoothStep( 0, 0.12f, age );
		float pop = 1 + 0.25f * MathF.Exp( -age * 9 );
		float size = 150 * 0.8f * pop;
		var at = q - new Vector2( 0, size * 0.35f );
		d = Over( d, Vector3.Zero, a * TextCentred( at, size, Call, 7 ) );
		d = Over( d, Vector3.One, a * TextCentred( at, size, Call, 1.5f ) );
		return d;
	}

	// ---------------------------------------------------------------- key hints (HudHints)
	Vector3 Hints( Vector2 q, Vector3 d )
	{
		// q relative to the bottom-left corner; rows upward
		if ( q.x > 300 || q.y < -110 || q.y > 4 ) return d;
		d = Key( d, q, 0, Label.KeyT, Label.HintThrowMode );
		d = Key( d, q, 1, Label.KeyP, Label.HintReset );
		if ( !AimMode ) d = Key( d, q, 2, Label.KeyWasd, Label.HintDrive );
		return d;
	}

	Vector3 Key( Vector3 d, Vector2 q, int row, int key, int hint )
	{
		float y = -26 - row * 30;
		float kw = LabelWidth( key ) * 13 + 14;
		d = Over( d, Vector3.Zero, 0.45f * Fill( Rect( q, 0, y, kw, 24, 5 ) ) );
		d = Over( d, Vector3.One, 0.35f * Outline( Rect( q, 0, y, kw, 24, 5 ), 1 ) );
		d = Over( d, Vector3.One, TextCentred( q - new Vector2( kw / 2, y + 17 ), 13, key, 0.3f ) );
		d = Over( d, Vector3.One * 0.85f, Text( q - new Vector2( kw + 8, y + 17 ), 13, hint, 0 ) );
		return d;
	}
}
