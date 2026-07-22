## Violent/Grease/Tampermonkey script to find off-meta builds from https://poe.ninja/poe1/builds.

I've created this script to help me find some cool off-meta builds that are probably homebrewed to hell. There are websites / apps that randomly select a skill (+ build and keystones if one wants to) to help you find a build that you might not have thought of, but I found them to be _too_ random, if that makes sense. Play a transfigured melee gem on a Necromancer, with Ancestral Bond allocated? No thanks man.

Please keep in mind that this script also suffer from the same problem, but to a lesser extent in my opinion. It still might pick some stupid main skill that clearly isn't _actually_ a main skill (like an aura or a guard skill), but at least it'll actually show the characters that, for some reason, have those skills in a 5+ link setup. If I try to find a Necromancer that's using Earthquake of Amplification with Ancestral Bond allocated, all I'll ever find is a big fat "Found 0 characters".

This does not send weird requests to the poe.ninja builds / profiles API, since that is specifically requested on their API documentation page, which you can find here: https://poe.ninja/docs/api. This script just sets some settings like ascendancy and minimum level, and then scrolls through the "Main Skills" tab on the builds page to find some off-meta skills according to the settings you set in the script.

## Installation

- Go to (whatever the link to the RAW file is on github)
- Copy everything in the file
- Open the Violent/Grease/Tampermonkey extension in whatever browser you're using
- Create a new script
- Paste the text you copied from the file
- Save/Create script
- Go to the poe.ninja builds page and select a league
- The button should now be located in the bottom right of the page.
