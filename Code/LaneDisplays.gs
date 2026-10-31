/// <summary>
/// The lane's world displays (the source's WorldPanels), drawn after lighting as flat panels in the world, depth
/// tested against the scene: the pin readout high over the backstop (PinReadout), the call over the lane in front
/// of the pins (AnnouncerCallout), the settee's score console (LaneConsole), the feed board (MonitorFeed: here a
/// top-down board of the ball and the rack, standing in for the source's second camera) and the podium signs.
/// </summary>
public sealed partial class Lane
{
	/// <summary>Where the view ray of this pixel meets a panel (front side only, in front of the scene), as panel pixels.</summary>
	static bool PanelAt( in ScreenPixel px, Vector3 centre, Vector3 facing, Vector3 up, Vector2 halfUnits, float pixelsPerUnit, out Vector2 q )
	{
		q = Vector2.Zero;
		var eye = Render.CameraPosition;
		float den = px.ViewDir.Dot( facing );
		if ( den >= -1e-4f ) return false;
		float t = (centre - eye).Dot( facing ) / den;
		if ( t <= 0 || t > px.Depth ) return false;
		var p = eye + px.ViewDir * t - centre;
		var right = up.Cross( facing );
		float u = p.Dot( right ), v = p.Dot( up );
		if ( MathF.Abs( u ) > halfUnits.x || MathF.Abs( v ) > halfUnits.y ) return false;
		// panel pixels from the top-left corner, y down
		q = new Vector2( u + halfUnits.x, halfUnits.y - v ) * pixelsPerUnit;
		return true;
	}

	/// <summary>The world displays over display colour d (see Lane.Screen); the lane's own ball hides what is behind it.</summary>
	Vector3 Displays( in ScreenPixel px, Vector3 d )
	{
		float ly = WorldPosition.y;
		if ( MathF.Abs( Render.CameraPosition.y - ly ) > 9000 ) return d;
		Vector2 q;
		var shell = Intersect.Sphere( Render.CameraPosition, px.ViewDir, Ball.WorldPosition, Ball.Radius );
		if ( shell.Hit && shell.Near > 0 && shell.Near < px.Depth ) return d;
		var back = new Vector3( -1, 0, 0 );   // facing up-lane, toward the bowler
		var front = new Vector3( 1, 0, 0 );   // facing the settee
		// the readout: 1726.8 x 2343.5 units over the backstop, laid out 1000 px wide
		if ( PanelAt( px, new Vector3( 24718.48f, ly, 2570.59f ), back, Vector3.Up, new Vector2( 863.4f, 1171.77f ), 1000 / 1726.81f, out q ) )
			d = Readout( q, d );
		// the call: over the lane in front of the pins
		if ( Call >= 0 && Clock - CallAt < CallSeconds && PanelAt( px, new Vector3( 24468.37f, ly, 962.94f ), back, Vector3.Up, new Vector2( 1220.6f, 244.1f ), 1000 / 2441.18f, out q ) )
		{
			float age = Clock - CallAt;
			float a = MathX.Clamp( (CallSeconds - age) / CallFade, 0, 1 );
			var at = q - new Vector2( 500, 100 + 48 );
			d = Over( d, Vector3.Zero, a * TextCentred( at, 140, Call, 9 ) );
			d = Over( d, Vector3.One, a * TextCentred( at, 140, Call, 1.5f ) );
		}
		// the settee's two overhead screens, facing the settee: the score console (+y) and the feed board (-y)
		if ( PanelAt( px, new Vector3( 24728.98f, ly + 136.8f, 782.82f ), front, Vector3.Up, new Vector2( 120, 67.5f ), 1200 / 240f, out q ) )
			d = Console( q, d );
		if ( PanelAt( px, new Vector3( 24728.98f, ly - 136.8f, 782.82f ), front, Vector3.Up, new Vector2( 120, 67.5f ), 1200 / 240f, out q ) )
			d = Feed( q, d );
		// podium signs: LANE, BALL, HELP
		for ( int k = 0; k < 3; k++ )
		{
			if ( PanelAt( px, new Vector3( Alley.PodiumX, ly - 142.4f + k * 142.4f, Alley.SetteeFloor + 66 ), front, Vector3.Up, new Vector2( 36, 11.57f ), 300 / 72f, out q ) )
				d = Sign( q, d, k == 0 ? Label.Lane : k == 1 ? Label.BallSign : Label.Help, k == 0 ? Css( 90, 160, 230 ) : k == 1 ? Css( 220, 70, 80 ) : Css( 150, 155, 170 ) );
		}
		return d;
	}

	static Vector3 Bg => new Vector3( 0.07f, 0.08f, 0.1f );

	Vector3 Readout( Vector2 q, Vector3 d )
	{
		d = Over( d, Bg, Fill( Rect( q, 0, 0, 1000, 1357, 24 ) ) );
		d = Over( d, Css( 90, 150, 220 ), 0.45f * Outline( Rect( q, 0, 0, 1000, 1357, 24 ), 6 ) );
		bool watching = Round == RoundWatching;
		d = Over( d, watching ? Css( 241, 196, 15 ) : Vector3.One, TextCentred( q - new Vector2( 500, 260 ), 90, watching ? Label.Watching : Label.Pins, 1.5f ) );
		for ( int row = 0; row < 4; row++ )
		{
			float cy = 400 + row * 142 + 58;
			for ( int k = 0; k < 4; k++ )
			{
				if ( k >= RowLen[row] ) break;
				int n = RackPins[RowStart[row] + k];
				float cx = 500 - RowLen[row] * 71 + k * 142 + 71;
				bool down = (DownBits >> n & 1) != 0;
				d = Over( d, down ? Css( 192, 57, 43 ) : Css( 46, 204, 113 ), Fill( (q - new Vector2( cx, cy )).Length - 58 ) );
				d = Over( d, down ? Vector3.Lerp( Css( 192, 57, 43 ), Vector3.One, 0.55f ) : Vector3.Zero, NumberCentred( q - new Vector2( cx, cy + 19 ), 54, n, 1 ) );
			}
		}
		// the lane's number under the rack
		d = Over( d, Vector3.One * 0.5f, TextCentred( q - new Vector2( 470, 1120 ), 60, Label.Lane, 0.5f ) );
		d = Over( d, Css( 90, 160, 230 ), Number( q - new Vector2( 470 + LabelWidth( Label.Lane ) * 30 + 16, 1120 ), 60, Index + 1, 0.5f ) );
		return d;
	}

	/// <summary>The settee's score screen: each bowler's name, frames and total (or the lobby's joined list).</summary>
	Vector3 Console( Vector2 q, Vector3 d )
	{
		d = Over( d, Bg, Fill( Rect( q, 0, 0, 1200, 675, 18 ) ) );
		d = Over( d, Css( 90, 150, 220 ), 0.55f * Outline( Rect( q, 0, 0, 1200, 675, 18 ), 4 ) );
		d = Over( d, Vector3.One, Text( q - new Vector2( 40, 70 ), 44, Label.Lane, 0.6f ) );
		d = Over( d, Css( 90, 160, 230 ), Number( q - new Vector2( 40 + LabelWidth( Label.Lane ) * 44 + 14, 70 ), 44, Index + 1, 0.6f ) );
		int status = !Playing ? Label.Lobby : GameOver ? Label.GameOver : Label.InPlay;
		d = Over( d, Css( 241, 196, 15 ), TextRight( q - new Vector2( 1160, 66 ), 30, status, 0.4f ) );
		if ( !Playing ) return d;
		var white = Vector3.One;
		for ( int p = 0; p < MaxPlayers; p++ )
		{
			if ( p >= RosterCount ) break;
			float y = 110 + p * 92;
			if ( q.y < y || q.y > y + 88 ) continue;
			bool up = p == Current && !GameOver;
			if ( up ) d = Over( d, Css( 241, 196, 15 ), 0.12f * Fill( Rect( q, 20, y, 1160, 86, 8 ) ) );
			d = Over( d, Terry.Shirt( Roster[p] ) * 1.6f, Fill( Rect( q, 30, y + 26, 12, 34, 3 ) ) );
			d = Over( d, white, Text( q - new Vector2( 54, y + 56 ), 30, Label.Player, 0.4f ) );
			d = Over( d, white, Number( q - new Vector2( 54 + Advance( 80 ) * 30 + 2, y + 56 ), 30, Roster[p] + 1, 0.4f ) );
			float x = 170;
			for ( int f = 0; f < 10; f++ )
			{
				float cw = f == 9 ? 128 : 86;
				if ( q.x >= x && q.x < x + cw )
				{
					if ( up && f == Frame ) d = Over( d, Css( 241, 196, 15 ), 0.2f * Fill( Rect( q, x, y, cw, 86, 0 ) ) );
					d = Over( d, white, 0.2f * Fill( Rect( q, x, y, 2, 86, 0 ) ) );
					int boxes = f == 9 ? 3 : 2;
					for ( int k = 0; k < 3; k++ )
					{
						if ( k >= boxes ) break;
						float bx = x + cw - 4 - (boxes - k) * 40, by = y + 4;
						bool split = (SplitBits[p] >> Slot( f, k ) & 1) != 0 && RollOf( p, f, k ) >= 0;
						if ( split ) d = Over( d, Css( 241, 196, 15 ), Outline( Rect( q, bx, by, 38, 38, 19 ), 3 ) );
						int m = Mark( p, f, k );
						if ( m != 0 ) d = Over( d, white, Char( q - new Vector2( bx + 19, by + 29 ), 26, m, 0.5f ) );
					}
					int t = Total( p, f );
					if ( t >= 0 ) d = Over( d, white, NumberCentred( q - new Vector2( x + cw / 2, y + 78 ), 28, t, 0.5f ) );
				}
				x += cw;
			}
		}
		return d;
	}

	/// <summary>The feed board: the lane from above, the ball and the rack as they are now.</summary>
	Vector3 Feed( Vector2 q, Vector3 d )
	{
		d = Over( d, Bg, Fill( Rect( q, 0, 0, 1200, 675, 18 ) ) );
		d = Over( d, Css( 90, 150, 220 ), 0.55f * Outline( Rect( q, 0, 0, 1200, 675, 18 ), 4 ) );
		// the lane runs left to right: foul line at x 80, the pit at x 1120; across: the bed and gutters
		float sx = 1040 / (Alley.PitEndX - Alley.FoulX), sy = 150 / Alley.GutterOut;
		var lane = new Vector2( 600, 360 );
		float ly = WorldPosition.y;
		d = Over( d, Css( 200, 150, 90 ), 0.85f * Fill( Rect( q, 80, lane.y - Alley.LaneHalf * sy, (Alley.DeckEndX - Alley.FoulX) * sx, 2 * Alley.LaneHalf * sy, 0 ) ) );
		d = Over( d, Css( 30, 32, 40 ), Fill( Rect( q, 80 + (Alley.DeckEndX - Alley.FoulX) * sx, lane.y - Alley.GutterOut * sy, (Alley.PitEndX - Alley.DeckEndX) * sx, 2 * Alley.GutterOut * sy, 0 ) ) );
		d = Over( d, Css( 220, 40, 40 ), Fill( Rect( q, 79, lane.y - Alley.GutterOut * sy, 3, 2 * Alley.GutterOut * sy, 0 ) ) );
		d = Over( d, Css( 40, 210, 230 ), Fill( Rect( q, 80 + (Alley.ThrowX - Alley.FoulX) * sx - 1, lane.y - Alley.GutterOut * sy, 3, 2 * Alley.GutterOut * sy, 0 ) ) );
		foreach ( var pin in Scene.All<Pin>() )
		{
			if ( pin.Lane.Index != Index || pin.Phase == Pin.Parked ) continue;
			var p = pin.WorldPosition;
			var at = new Vector2( 80 + (p.x - Alley.FoulX) * sx, lane.y - (p.y - ly) * sy );
			bool down = pin.Fallen;
			d = Over( d, down ? Css( 192, 57, 43 ) : Vector3.One, pin.Alpha * Fill( (q - at).Length - 7 ) );
		}
		var b = Ball.WorldPosition;
		if ( b.x > Alley.FoulX - 400 && b.x < Alley.PitEndX + 200 && MathF.Abs( b.y - ly ) < Alley.PlatformHalf )
		{
			var at = new Vector2( 80 + (b.x - Alley.FoulX) * sx, lane.y - (b.y - ly) * sy );
			d = Over( d, Css( 111, 211, 255 ), Fill( (q - at).Length - Ball.Radius * sy ) );
		}
		d = Over( d, Vector3.One * 0.6f, Text( q - new Vector2( 40, 640 ), 26, Label.FeedTitle, 0.3f ) );
		return d;
	}

	Vector3 Sign( Vector2 q, Vector3 d, int label, Vector3 accent )
	{
		d = Over( d, Bg, Fill( Rect( q, 0, 0, 300, 96, 14 ) ) );
		d = Over( d, accent, Outline( Rect( q, 0, 0, 300, 96, 14 ), 6 ) );
		d = Over( d, Vector3.One, TextCentred( q - new Vector2( 150, 66 ), 48, label, 1 ) );
		return d;
	}
}
