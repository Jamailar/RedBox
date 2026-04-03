---
name: redbox-video-director
description: Use when generating short videos with RedBox official video API. Produces a detailed shot script first, asks the user to confirm it, then chooses between text-to-video, reference-guided, and first-last-frame modes and calls the correct wan2.7 video model with prompt discipline focused on motion, reference elements, and transitions.
when_to_use: Trigger for short video generation, motion clip creation, animated cover/video requests, reference-image video, image-to-video, or first/last frame transitions.
allowed-tools: app_cli
---

# RedBox Video Director

Use this skill before calling `app_cli(command="video generate ...")` for RedBox video work.

## Default Workflow

Before any video tool call, follow this order:

1. Clarify the intended video mode from the user's goal and assets.
2. Draft a concise but detailed video script for review.
3. Decide whether this should be a single-video job or a multi-video assembly.
4. If the script is visually complex, ask whether storyboard stills should be generated first.
5. Show the script to the user together with explicit video specs.
6. Ask for confirmation or revision.
7. Only after confirmation, call `app_cli(command="video generate ...")`.

If the user has not yet confirmed the script, do not generate the video.

## Hard Rules

- RedBox video generation is locked to the RedBox official video route.
- Do not choose arbitrary video endpoints or third-party video models.
- Use only these official model mappings:
  - `text-to-video` -> `wan2.7-t2v-video`
  - `reference-guided` -> `wan2.7-r2v-video`
  - `first-last-frame` -> `wan2.7-i2v-video`
- Treat first/last-frame transitions as a subtype of image-to-video work.
- Do not skip the script review step just because the request sounds obvious.
- Unless the user explicitly asks for a longer continuous shot, a single shot should usually be `1-3` seconds.
- Without explicit user approval, any single shot must not exceed `5` seconds.

## Mode Selection

- Use `text-to-video` when the user only provides text and wants a fresh video shot.
- Use `reference-guided` when the user provides one or more reference images and wants the video to absorb subject elements, style cues, props, scene motifs, or composition hints from those images.
- Use `first-last-frame` only when two images have explicit start/end semantics, such as “from A to B”, “首帧/尾帧”, “开头/结尾”, or “起始状态/结束状态”.
- If the user gives two images but they are only style references, do not use `first-last-frame`; stay with `reference-guided` semantics instead.

## Production Strategy

- `单视频模式`:
  - Use one generated video clip.
  - Default when the request is simple, the action is short, and the full idea fits inside one coherent clip.
  - A single generated clip must not exceed `15` seconds.

- `多视频模式`:
  - Use multiple clips when the request contains many beats, scene changes, multiple camera setups, or a narrative that would be unstable as one long clip.
  - Generate the required clips one by one, then combine them with `ffmpeg` through the available tool path.
  - When planning multi-video mode, group the storyboard into separate clip units first, then specify the final concatenation order.

- If the request is complex enough that the spatial layout or transitions are likely to drift, ask one more question after drafting the table:
  - whether storyboard images should be generated first.
- If storyboard images are generated, later video generation should preferentially use image-based modes, and for transition-heavy segments should prefer `first-last-frame`.

## Script Format

The pre-generation script must be shown as a Markdown table. Use these columns:

| Time | Picture | Sound | Shot |
| --- | --- | --- | --- |

Requirements:

- Before the table, explicitly state:
  - `视频时长`
  - `视频比例`
- `Time`: use compact ranges such as `0-2s`, `2-4s`, `4-6s`.
- `Picture`: describe subject action, motion, camera movement, scene changes, and what must stay stable.
- `Sound`: describe spoken line, ambient sound, music feel, silence, or rhythm cue.
- `Shot`: describe shot scale / framing, such as close-up, medium shot, wide shot, push-in, pan, tilt.
- Keep the table practical. It should be detailed enough to approve production, not a vague concept note.
- Each row should usually represent a shot or one stable motion segment.
- Shot duration should usually stay in the `1-3s` range.
- Without a clear user requirement, do not plan any row longer than `5s`.

After the table, add one short confirmation prompt, for example:

- `请确认这版视频脚本，我确认后再正式生成。`

If the user requests changes, revise the table first and wait again.
If duration or aspect ratio is not yet specified, propose a concrete default and include it in the confirmation block so the user can approve or change it.
If the script is complex, also ask whether the user wants storyboard stills first.

## Prompt Discipline

- If reference assets are attached, start the final generation prompt by identifying what each asset is for.
- Use explicit labels such as:
  - `Image 1: Jamba portrait reference`
  - `Image 2: livestream background mood reference`
  - `Audio 1: Jamba voice reference for tone and speaking rhythm`
- Do this before the motion/camera description so the model does not confuse multiple references.
- For `text-to-video`, describe subject, camera, motion, environment, pacing, and visual style.
- For `reference-guided`, describe the desired movement and cinematic behavior while preserving and combining the important elements from the provided reference images.
- For `first-last-frame`, describe the transition between the first and last frame; do not rewrite the full scene unless the transition requires it.
- Avoid bloated prompts that restate the whole image contents when the real task is only a motion or transition edit.
- Focus on what should move, how the camera behaves, and what must stay stable.

## Tool Usage

- Always use `app_cli(command="video generate ...")`.
- Pass no reference images for `text-to-video`.
- Pass 1 to 5 reference images for `reference-guided`.
- Pass exactly two reference images in `首帧,尾帧` order for `first-last-frame`.
- If a suitable voice reference exists, pass it as `drivingAudio` and describe it explicitly as `Audio 1` in the prompt preface.
- Keep the final generation prompt focused on execution details derived from the approved script.
- Do not dump the whole planning discussion into the generation prompt.
- If the user intent is ambiguous, explain the ambiguity briefly and pick the safer mode instead of faking certainty.
- For multi-video mode, generate each clip deliberately, then use `ffmpeg` tooling to concatenate them in storyboard order after all clips succeed.
