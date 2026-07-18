Unit sprite sheet format
========================

Put one PNG per unit type in this folder:

- melee.png
- archer.png
- catapult.png
- runner.png
- bruiser.png
- siege.png
- boss.png

Each PNG is a 3-column by 5-row sprite sheet.

Columns:
1. Frame 1
2. Frame 2
3. Frame 3

Rows:
1. idle
2. walk
3. attack
4. hit
5. death

Sprites are drawn as left-facing by default. The game flips the same frames
horizontally when a unit faces right.
