# Endless Sky Galaxy

An external, 3D viewer for the galaxy map of
[Endless Sky](https://github.com/endless-sky/endless-sky). The galaxy is still
the game's flat 2D map, laid out on a plane you can pan across, zoom into, tilt
and turn. Click a system to see its government, stars, planets and their
facilities, trade prices and links.

It reads the game's data straight from a check-out, so it can show any version
of the game, including development branches. It isn't bound by the game's
rules: hidden, shrouded and inaccessible systems are all shown, and can be
picked out with the *Map visibility* colour mode.

Only the galaxy's **base state** is shown, as defined at the top level of the
game's `data/` files. Mission events change the galaxy as the player
progresses (adding systems and links, changing governments and so on); none
of those changes are applied. The one exception is region labels that events
reveal. Their images follow a predictable naming scheme, so they're shown,
and can be switched off under *View*.

## Usage

```sh
npm install
npm run extract -- /path/to/endless-sky   # ../endless-sky by default, or $ES_PATH
npm run dev
```

`npm run extract` writes `public/data/galaxy.json` and copies the sprites it
needs into `public/sprites/` (both git-ignored). Re-run it after switching the
check-out to another branch or commit. The version it was extracted from is
shown next to the title.

You don't need a check-out of the game at all. Give a ref instead, and the
extractor fetches just the files it needs (about 50 MB) from GitHub:

```sh
npm run extract -- --ref master           # a branch
npm run extract -- --ref v0.11.3          # a release tag
npm run extract -- --ref pull/12766/head  # a pull request
npm run extract -- --ref my-branch --repo https://github.com/someone/endless-sky.git
```

The sparse, shallow check-out is kept in `.cache/endless-sky/` (git-ignored)
and re-used, so moving to another ref only fetches what changed. The
repository is upstream unless `--repo` names a fork.

### Controls

- Drag to pan.
- Right-drag to tilt and turn.
- Scroll to zoom (towards the cursor).
- Click a system to inspect it, or double-click to fly in close.
- <kbd>Esc</kbd> unselects.

## How it works

- `scripts/dataFile.js` reads the game's indented data-file format.
- `scripts/extract.js` loads the top-level `system`, `planet`, `government`,
  `galaxy`, `wormhole`, `star`, `color` and `trade` definitions. It applies
  repeat definitions the way the game does (a plain key replaces earlier
  values, `add` appends, `remove` deletes) and resolves sprites to image files.
- `scripts/events.js` sorts the mission events that change the map or planets
  into those a reference can assume have happened (the player completing each
  storyline) and those that hang on a story choice, such as how the Free
  Worlds war ends. It finds the branches from the missions' conditions;
  `scripts/eventChoices.js` only gives them readable names. Applying them in
  the viewer is still to come.
- `src/lib/three/createGalaxyScene.js` draws the map with three.js. One world
  unit is one map unit, and the sizes and offsets of rings and links are taken
  from the game's `MapPanel.cpp`. The colours follow the game's map modes where
  it has an equivalent.

## Licence and credits

The code in this repository is licensed under the GNU General Public License
v3.0; see [LICENSE](LICENSE).

Endless Sky is by Michael Zahniser and the Endless Sky contributors. This is an
unofficial fan project. The extracted galaxy data and sprites remain under the
game's licences (GPL-3.0 and various Creative Commons licences, as listed in
the game's `copyright` file). They aren't stored in this repository; they're
generated from your own check-out.

The UI uses the [Ubuntu](https://fonts.google.com/specimen/Ubuntu) type-face,
which the game's bitmap fonts are rendered from.
