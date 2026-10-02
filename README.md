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

Mission events change the galaxy as the player progresses: governments
change hands, links open and close, hidden systems are revealed. By default
the map shows the galaxy as if every storyline had been played through.
Where the story branches, such as how the Free Worlds war ends, *Story* lets
you pick the outcome. It can also switch the events off, to show the galaxy as
a new game starts. The *Changed by story events* colour mode picks out the
systems the story changes, and a system's panel lists the events that changed
it. Region labels that events reveal are shown either way; they can be
switched off under *View*.

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

### What's changed since another version

The extractor also reads a second version to compare against: the latest
release, or for a release, the one before it. *Since <version>* then lists
the systems that are new, removed or changed, and can colour the map by them,
with removed systems and links drawn as red ghosts and new links in green. A
system's panel says what changed: its government, links, planets, services,
prices and so on. Both versions are compared after their story events, with
the same story choices. Pick another version, or none:

```sh
npm run extract -- --ref master --compare v0.10.0
npm run extract -- --compare none
```

Systems and planets are matched by name, so a renamed one shows as removed
and added.

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
  `scripts/eventChoices.js` only gives them readable names and defaults.
- `src/lib/data/universe.js` loads systems and planets as the game does. The
  extractor uses it to read the data files, and the viewer to apply events,
  since events go through the same loading code as the definitions. The
  viewer is sent the events' changes already parsed.
- `scripts/readGalaxy.js` reads one check-out; `scripts/extract.js` fetches
  and reads the version shown and the one compared against.
  `src/lib/data/compareGalaxies.js` works out what changed between them.
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
