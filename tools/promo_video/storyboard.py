# The storyboard of the 1-minute promo: which part of which recording is shown, for how long, with which caption.  (exec'd by build_full.py)
# Times of a recorded scene are written as  rec(scene, mark, offset, seconds, speed, zoom)  - the mark is a moment the recorder noted - or as absolute seconds of the webm via shot(file, start, seconds, speed, zoom).
# A zoom is (from, to, anchor x, anchor y): a slow push-in.  chips: (caption key, appears, disappears[, sub caption key[, big]]) - seconds inside the segment.
V = lambda name: f"{PV}/{name}.webm"
Z = lambda a=1.0, b=1.06, x=0.5, y=0.5: (a, b, x, y)

# 1. hook: the break of a match (the game itself shows the table's name), the title
add(seg("hook", [shot(OLD[0]["file"], 4.6, 3.8, 1.0, Z(1.0, 1.05))], chips=[("title", 1.8, 3.8, "title_sub", "mid")]))
# 2. matches: real physics, many tables
add(seg("match", [shot(V("gift"), 6.9, 3.0, 1.0, Z(1.0, 1.04)), old(7, "aim", 2.6, Z(1.0, 1.05))], chips=[("physics", 0.25, 2.8), ("tables", 3.2, 5.4)]))
# 3. club: the list, the new club (name typed, animated emblem), members arrive, the weekly chest fills, the club chat
add(seg("club", [shot(V("club"), 6.4, 1.3, 1.0, Z(1.0, 1.05)), shot(V("club"), 11.2, 1.7, 2.2), shot(V("club"), 16.2, 2.2, 2.4), shot(V("club"), 23.4, 1.5, 4.3), shot(V("club"), 30.1, 1.9, 1.0), shot(V("club"), 35.0, 1.7, 3.0)],
        chips=[("club", 0.3, 6.5), ("club2", 6.9, 10.2)]))
# 4. lobby for 8 players, talking by voice (the join phase is a time-lapse; the green rings of the talking players pulse; lines written by the others pop up)
add(seg("lobby", [rec("lobby", "chooser", -0.4, 1.3, 1.0, Z(1.0, 1.04)), rec("lobby", "created", -1.3, 3.3, 4.5), rec("lobby", "micOn", 1.0, 4.0, 1.5, Z(1.0, 1.05, 0.62, 0.45))],
        chips=[("lobby", 0.3, 5.0), ("voice", 5.3, 9.0)]))
# 5. world chat
add(seg("world", [shot(V("world"), 9.0, 1.6, 1.0, Z(1.0, 1.04)), shot(V("world"), 11.8, 1.8, 2.5), shot(V("world"), 20.6, 1.2, 2.0), shot(V("world"), 25.2, 1.6, 2.0)],
        chips=[("world", 0.3, 3.2), ("world2", 3.5, 6.0)]))
# 6. gifts and the quick chat of a match, the win
add(seg("gift", [shot(V("gift"), 22.6, 3.3, 2.2), shot(V("gift"), 33.6, 2.7, 1.5), shot(V("gift"), 40.9, 2.0, 1.0, Z(1.2, 1.24, 0.5, 0.0))], chips=[("gift", 0.3, 3.2), ("chat", 3.6, 6.0)]))
# 7. the shop: cues, tables, avatars (standard first, then a quick flight down to the legendary ones), frames
add(seg("shop", [rec("shop", "cues", 0.05, 1.7, 1.0), rec("shop", "tables", 0.1, 1.8, 1.0), rec("shop", "avatars_a", -0.1, 1.5, 1.4), rec("shop", "avatars_b", -0.4, 1.0, 1.0), rec("shop", "frames", 0.1, 1.8, 1.0)],
        chips=[("cues", 0.2, 1.6), ("tbl", 1.9, 3.4), ("avs", 3.8, 6.0), ("frames", 6.4, 7.8)]))
# 8. the VIP cue ad: pages of the VIP window cut fast (a white flash between them), the cue in a match, "Unlock the legend"
add(vip_card(1.7))
vp = [("champion", Z(1.04, 1.14, 0.3, 0.5)), ("kaboom", Z(1.12, 1.03, 0.3, 0.5)), ("aries", Z(1.03, 1.14, 0.3, 0.5)), ("aquarius", Z(1.12, 1.03, 0.3, 0.5)), ("wolf", Z(1.03, 1.14, 0.3, 0.5)), ("ghost", Z(1.12, 1.03, 0.3, 0.5))]
for i, (nm, zm) in enumerate(vp): add(seg(f"vip{i}", [rec("vip", nm, 0.25, 1.4, 1.0, zm)]), "fadewhite", 0.14)
add(seg("vipgame", [shot(V("gift"), 30.4, 2.2, 1.0, Z(1.0, 1.3, 0.5, 0.5))], chips=[("vip_end", 0.3, 2.1)]), "fadewhite", 0.14)
# 9. the end card
add(endcard(3.6))
total = render(OUT); json.dump({'total': total, 'starts': starts()}, open(OUT.rsplit('.', 1)[0] + '_times.json', 'w')); print(starts())
