# MathFox Classroom

The student space uses Supabase Auth for email and password accounts. Supabase stores student preferences, the current classroom, and board notes from lessons students visit.

## Run locally

Use Node.js 20 or later. Apply the SQL under `supabase/migrations` to your dedicated Supabase project, then copy `.env.example` to `.env` and fill in the project URL, publishable key and server-only secret key. The legacy anon and service-role keys also work through `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`.

```sh
node --env-file=.env server.cjs
```

Open http://127.0.0.1:5174/learn. If email confirmation is enabled, set the Supabase Auth Site URL to http://127.0.0.1:5174/learn for local development. After confirming your email, return to the student space and sign in. Configure Auth email delivery for the intended audience before launch.

To teach, create and confirm an account, add its Supabase Auth user UUID to `CLASSROOM_TEACHER_IDS`, and restart the server. The Classes view then shows **Open teacher classroom**. Start a lesson from **Teacher controls** and use a different signed-in account in a separate browser profile to verify the student experience. The list shows the current live room and refreshes every 15 seconds.

For a developer-only classroom without Supabase, run `CLASSROOM_LOCAL_PREVIEW=1 node server.cjs` and open http://127.0.0.1:5174/classroom.

## Hosting and classroom behavior

This implementation runs one long-lived Node process bound to loopback. Supabase stores the room snapshot across restarts. Server-sent events handle live updates, and the process handles presence and WebRTC signaling. Multiple Node instances would require shared signaling and coordinated state writes. The static Netlify landing preview does not run the classroom server. A public rollout still needs hosted signaling, appropriate classroom membership controls and moderation, and production audio infrastructure.

`OPENAI_API_KEY` enables AI teaching steps. Each student’s browser handles narration. Teacher microphone audio requires microphone permission and browser WebRTC connectivity. Board notes are private to the signed-in student and contain written working and visible rows. The server retains up to 40 recent visits in the student-space view.

## Homework Helper board compatibility

The classroom board supports the original Homework Helper layouts: working rows, aligned arithmetic columns and schematic triangle-angle diagrams. It formats numeric fractions, superscripts and subscripts and renders all generated content as text. Optional board cues can be enabled under Board colors. The teacher can attach a puzzle image; the current image is held only in local server memory for AI follow-up turns, replaced when a new image is sent and cleared when the lesson ends or a new lesson starts. The image is not broadcast to students or stored in lesson history. The board does not reconstruct arbitrary diagrams or provide freehand drawing. AI vision and speech have not been tested against a live API.
