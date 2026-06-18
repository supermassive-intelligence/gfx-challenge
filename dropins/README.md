# Drop-in bundle for the Berzerk + Gemma project

Files in this bundle, with destinations relative to your repo root
(`/home/user/sudnya/berzerk` on the opencode node):

| File                          | Destination               |
|-------------------------------|---------------------------|
| `checker.py`                  | `./checker.py`            |
| `berzerk_visual_spec.md`      | `./docs/berzerk_visual_spec.md` |
| `rubric_visual_identity.md`   | `./docs/rubric_visual_identity.md` |
| `rubric_robot_ai.md`          | `./docs/rubric_robot_ai.md` |
| `rubric_maze_walls_otto.md`   | `./docs/rubric_maze_walls_otto.md` |
| `rubric_player_combat.md`     | `./docs/rubric_player_combat.md` |

One-liner once `./docs/` exists in your repo:

    cp checker.py /home/user/sudnya/berzerk/
    cp berzerk_visual_spec.md rubric_*.md /home/user/sudnya/berzerk/docs/

Then `pip install openai>=1.0` once, and `python checker.py` will run.

`checker.py` reads `~/.config/opencode/config.json` for its endpoint and
model. Environment variables (`SCALARLM_BASE_URL`, `SCALARLM_API_KEY`,
`SCALARLM_MODEL`) override the config if you set them.
