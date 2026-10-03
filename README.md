# Endless Sky Galaxy

An external, 3D viewer for the galaxy map of
[Endless Sky](https://github.com/endless-sky/endless-sky). The galaxy is still
the game's flat 2D map, laid out on a plane you can pan across, zoom into, tilt
and turn. Click a system to see its government, stars, planets and their
facilities, trade prices and links.

*Enter system* opens a view of the system itself: its stars, planets, moons
and stations on their orbits, worked out as the game does, on any date from
the day a new game starts, and played forwards at up to 1000 days a second.
Asteroid belts are marked, and a wormhole says where it leads. The system's
panel lists its hazards, such as the Ember Waste's storms: where each applies,
how often it comes and what it does. Those with a limited range, such as a
black hole's pull, are shaded over the area they cover. Behind it all is the
system's background as the game draws it in flight: a field of stars, thinned
out in sparse systems, and patches of the system's haze.

A planet's details start with its landing image, the picture the game shows
when you land there. Its outfitters and shipyards list what they sell, grouped
as the game groups them, along with the ammunition every outfitter restocks.
Click an item, or search for an outfit or ship, to see on the map everywhere
it's sold.

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
npm run extract -- --releases 3   # the last three stable releases
npm run dev
```

The extractor stores each version of the game it reads in its own file in
`public/data/versions/`, listed in `public/data/versions.json`, and the
sprites they use in `public/sprites/` (all git-ignored). The menu by the title
switches between them, and the address names the one shown (`#v0.11.2`), so a
link opens it.

`--releases N` keeps exactly the newest N stable releases, as GitHub marks them
(not pre-releases), adding any that are missing and removing older ones. It
needs no check-out of the game: it fetches just the files it needs from GitHub
(about 300 MB, most of it planet, star and landing images) into a sparse,
shallow check-out in `.cache/endless-sky/` (git-ignored), re-used so another
version only fetches what changed. A version already stored at the same commit
isn't extracted again, unless `--force` is given.

Other versions can be added alongside, to follow development, and stay until
removed:

```sh
npm run extract -- --ref master           # a branch
npm run extract -- --ref v0.11.3          # a pre-release
npm run extract -- --ref pull/12766/head  # a pull request
npm run extract -- --ref my-branch --repo https://github.com/someone/endless-sky.git
npm run extract -- /path/to/endless-sky   # a local check-out (../endless-sky by default, or $ES_PATH)
npm run extract -- --remove master
npm run extract -- --list
```

Sprites are shared by the versions, named by their content so that an image
changed in one version doesn't replace it in another. Any no stored version
uses are removed.

### What's changed since another version

*Since <version>* compares the version shown with another stored one: by
default the stable release before it, or for anything else, the newest stable
release. Any other stored version can be picked instead, or none. It lists the
systems that are new, removed or changed, and can colour the map by them, with
removed systems and links drawn as red ghosts and new links in green. A
system's panel says what changed: its government, links, planets, services,
prices and so on. Both versions are compared after their story events, with
the same story choices.

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
- `scripts/readGalaxy.js` reads one check-out; `scripts/extract.js` fetches,
  reads and stores versions, and `src/lib/data/versions.js` decides which are
  stable, shown and compared.
  `src/lib/data/compareGalaxies.js` works out what changed between them.
- `src/lib/data/orbits.js` places a system's objects on a date, and
  `src/lib/three/createSystemScene.js` draws them, over the background from
  `src/lib/three/createBackground.js` (after the game's `StarField.cpp`).
- `src/lib/three/createGalaxyScene.js` draws the map with three.js. One world
  unit is one map unit, and the sizes and offsets of rings and links are taken
  from the game's `MapPanel.cpp`. The colours follow the game's map modes where
  it has an equivalent.

### Tests

```sh
npm test
```

runs the tests of the data logic with Node's own test runner: the data-file
parser, loading and merging definitions as the game does, sprite file names,
orbits, hazards, sorting events into assumed ones and story choices, applying
them, and comparing versions. They use small samples of game data written into the
tests, so they need no check-out.

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
