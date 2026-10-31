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
		if ( Render.InView ) return d;
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

	/// <summary>
	/// The feed camera (LaneMonitorCamera): chasing the ball down the lane, the pin deck while the throw is watched, the
	/// rack from behind the foul line while the lane waits. Off while the lane is idle.
	/// </summary>
	void FeedCamera()
	{
		var view = Camera.View( Index );
		if ( !Playing ) { view.Disable(); return; }
		float ly = WorldPosition.y;
		var b = Ball.WorldPosition;
		var deck = new Vector3( Alley.DeckCenterX, ly, Alley.H );
		Vector3 at, look;
		if ( Round == RoundWatching || Round == RoundSettled ) { at = deck + new Vector3( -1500, 420, 520 ); look = deck + new Vector3( 0, 0, 120 ); }
		else if ( Ball.Mode == Ball.Rolling && b.x > Alley.FoulX - 400 && b.x < Alley.DeckEndX ) { at = b + new Vector3( -950, 0, 280 ); look = b + new Vector3( 900, 0, -40 ); }
		else { at = new Vector3( Alley.FoulX - 600, ly, Alley.H + 420 ); look = deck; }
		view.Set( at, Rotation.LookAt( (look - at).Normal ), 55, 10, 60000 );
	}

	/// <summary>The feed board: this lane's feed camera, live.</summary>
	Vector3 Feed( Vector2 q, Vector3 d )
	{
		d = Over( d, Bg, Fill( Rect( q, 0, 0, 1200, 675, 18 ) ) );
		float inside = Fill( Rect( q, 14, 14, 1172, 647, 10 ) );
		if ( Playing && inside > 0 )
		{
			var feed = FeedView.Sample( new Vector2( (q.x - 14) / 1172, 1 - (q.y - 14) / 647 ) ).Rgb;
			d = Over( d, ToDisplay( feed ), inside );
		}
		else d = Over( d, Vector3.One * 0.45f, TextCentred( q - new Vector2( 600, 360 ), 40, Label.FeedTitle, 0.3f ) );
		d = Over( d, Css( 90, 150, 220 ), 0.55f * Outline( Rect( q, 0, 0, 1200, 675, 18 ), 4 ) );
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
