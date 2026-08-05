# clips/ — the committed hero capture

`hero-mudiii.webm` is the raw Playwright recording, `hero-mudiii.mp4` is the
web-ready conversion (silent, H.264, faststart), and `hero-frame.png` is a
mid-clip frame for a quick visual check. The mp4 is also copied to
`public/media/hero-mudiii.mp4`, which is the file the homepage hero plays.

## Prompt to regenerate this clip

Give Claude Code this prompt, verbatim:

> Regenerate the hero clip. Run `npm run capture:hero` (it builds a fresh demo
> site, serves it locally, and records a 75-second silent 1280x640 capture of
> the mudiii demo into `clips/hero-mudiii.webm`; run it in the background, it
> takes a couple of minutes). Convert it with
> `ffmpeg -i clips/hero-mudiii.webm -c:v libx264 -pix_fmt yuv420p -movflags +faststart -an clips/hero-mudiii.mp4`
> (if ffmpeg is missing, VLC's CLI transcoding to h264 with audio stripped is
> an acceptable fallback). Check the mp4: duration 60-90 seconds, 1280x640,
> well under 15 MB. Extract a frame with
> `ffmpeg -ss 30 -i clips/hero-mudiii.mp4 -frames:v 1 clips/hero-frame.png`
> and look at it to confirm it shows the live demo, not a blank page. Then copy
> the mp4 over `public/media/hero-mudiii.mp4` and commit `clips/` and
> `public/media/hero-mudiii.mp4` together.

The capture script is `test-capture/hero-mudiii.capture.mjs`. CI's
`capture:hero` job records the same clip against the deployed site after every
deploy and keeps it as a one-week artifact, so a fresh cloud copy is usually
one pipeline away.
