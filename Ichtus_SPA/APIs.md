# ProPresenter API — Full Endpoint Reference  
_All endpoints with one‑sentence descriptions._

---

## Announcement API

- **GET /v1/announcement/active** — Returns the currently active announcement presentation.  
- **GET /v1/announcement/active/focus** — Moves UI focus to the active announcement presentation.  
- **GET /v1/announcement/active/next/trigger** — Triggers the next cue in the active announcement.  
- **GET /v1/announcement/active/previous/trigger** — Triggers the previous cue in the active announcement.  
- **GET /v1/announcement/active/timeline** — Retrieves the timeline state of the active announcement.  
- **GET /v1/announcement/active/timeline/{operation}** — Performs a timeline operation (play/pause/rewind) on the active announcement.  
- **GET /v1/announcement/active/trigger** — Retriggers the active announcement from the beginning.  
- **GET /v1/announcement/active/{index}/trigger** — Triggers a specific cue in the active announcement.  
- **GET /v1/announcement/slide_index** — Returns the index of the current announcement slide.

---

## Audio Playlist API

- **GET /v1/audio/playlist/active** — Returns the active audio playlist.  
- **GET /v1/audio/playlist/active/focus** — Focuses the active audio playlist.  
- **GET /v1/audio/playlist/active/next/trigger** — Plays the next audio item.  
- **GET /v1/audio/playlist/active/previous/trigger** — Plays the previous audio item.  
- **GET /v1/audio/playlist/active/trigger** — Restarts the active audio playlist.  
- **GET /v1/audio/playlist/active/{id}/trigger** — Triggers a specific audio item in the active playlist.  
- **GET /v1/audio/playlist/focused** — Returns the currently focused audio playlist.  
- **GET /v1/audio/playlist/focused/next/trigger** — Plays the next item in the focused playlist.  
- **GET /v1/audio/playlist/focused/previous/trigger** — Plays the previous item in the focused playlist.  
- **GET /v1/audio/playlist/focused/trigger** — Starts the focused audio playlist.  
- **GET /v1/audio/playlist/focused/{id}/trigger** — Triggers a specific item in the focused playlist.  
- **GET /v1/audio/playlist/next/focus** — Moves focus to the next audio playlist.  
- **GET /v1/audio/playlist/previous/focus** — Moves focus to the previous audio playlist.  
- **GET /v1/audio/playlist/{playlist_id}** — Lists all audio items in a playlist.  
- **GET /v1/audio/playlist/{playlist_id}/focus** — Focuses a specific audio playlist.  
- **GET /v1/audio/playlist/{playlist_id}/next/trigger** — Plays the next item in a playlist.  
- **GET /v1/audio/playlist/{playlist_id}/previous/trigger** — Plays the previous item in a playlist.  
- **GET /v1/audio/playlist/{playlist_id}/trigger** — Starts the specified audio playlist.  
- **GET /v1/audio/playlist/{playlist_id}/updates** — Streams updates when the playlist changes.  
- **GET /v1/audio/playlist/{playlist_id}/{id}/trigger** — Triggers a specific audio item.  
- **GET /v1/audio/playlists** — Lists all audio playlists.

---

## Capture API

- **GET /v1/capture/encodings/{type}** — Lists available capture modes for a given type.  
- **GET /v1/capture/settings** — Returns current capture settings.  
- **GET /v1/capture/status** — Returns capture status and elapsed time.  
- **GET /v1/capture/{operation}** — Starts or stops capture.

---

## Clear API

- **DELETE /v1/clear/group/{id}** — Deletes a clear group.  
- **GET /v1/clear/group/{id}** — Returns details of a clear group.  
- **PUT /v1/clear/group/{id}** — Updates a clear group.  
- **GET /v1/clear/group/{id}/icon** — Retrieves a clear group’s icon.  
- **PUT /v1/clear/group/{id}/icon** — Sets a custom icon for a clear group.  
- **GET /v1/clear/group/{id}/trigger** — Triggers a clear group.  
- **GET /v1/clear/groups** — Lists all clear groups.  
- **POST /v1/clear/groups** — Creates a new clear group.  
- **GET /v1/clear/layer/{layer}** — Clears a specific layer (slides, media, audio, etc.).

---

## Misc

- **GET /v1/find_my_mouse** — Activates the “Find My Mouse” effect.

---

## Global Groups

- **GET /v1/groups** — Lists all global groups.

---

## Library API

- **GET /v1/libraries** — Lists all libraries.  
- **GET /v1/library/{library_id}** — Lists items in a library.  
- **GET /v1/library/{library_id}/{presentation_id}/trigger** — Triggers the first cue of a presentation.  
- **GET /v1/library/{library_id}/{presentation_id}/{index}/trigger** — Triggers a specific cue.

---

## Looks API

- **GET /v1/look/current** — Returns the active audience look.  
- **PUT /v1/look/current** — Updates the active audience look.  
- **DELETE /v1/look/{id}** — Deletes a saved look.  
- **GET /v1/look/{id}** — Returns details of a look.  
- **PUT /v1/look/{id}** — Updates a look.  
- **GET /v1/look/{id}/trigger** — Activates a look.  
- **GET /v1/looks** — Lists all saved looks.  
- **POST /v1/looks** — Creates a new look.

---

## Macro API

- **DELETE /v1/macro/{id}** — Deletes a macro.  
- **GET /v1/macro/{id}** — Returns macro details.  
- **PUT /v1/macro/{id}** — Updates a macro.  
- **GET /v1/macro/{id}/icon** — Retrieves a macro icon.  
- **PUT /v1/macro/{id}/icon** — Sets a macro icon.  
- **GET /v1/macro/{id}/trigger** — Triggers a macro.  
- **DELETE /v1/macro_collection/{id}** — Deletes a macro collection.  
- **GET /v1/macro_collection/{id}** — Returns a macro collection.  
- **PUT /v1/macro_collection/{id}** — Updates a macro collection.  
- **GET /v1/macro_collections** — Lists all macro collections.  
- **POST /v1/macro_collections** — Creates a macro collection.  
- **GET /v1/macros** — Lists all macros.

---

## Masks API

- **GET /v1/mask/{id}** — Returns mask details.  
- **GET /v1/mask/{id}/thumbnail** — Returns a mask thumbnail.  
- **GET /v1/masks** — Lists all masks.

---

## Media Playlist API

- **GET /v1/media/playlist/active** — Returns the active media playlist.  
- **GET /v1/media/playlist/active/focus** — Focuses the active media playlist.  
- **GET /v1/media/playlist/active/next/trigger** — Plays the next media item.  
- **GET /v1/media/playlist/active/previous/trigger** — Plays the previous media item.  
- **GET /v1/media/playlist/active/trigger** — Starts the active media playlist.  
- **GET /v1/media/playlist/active/{media_id}/trigger** — Triggers a specific media item.  
- **GET /v1/media/playlist/focused** — Returns the focused media playlist.  
- **GET /v1/media/playlist/focused/next/trigger** — Plays the next item in the focused playlist.  
- **GET /v1/media/playlist/focused/previous/trigger** — Plays the previous item.  
- **GET /v1/media/playlist/focused/trigger** — Starts the focused playlist.  
- **GET /v1/media/playlist/focused/{media_id}/trigger** — Triggers a specific media item.  
- **GET /v1/media/playlist/next/focus** — Focuses the next media playlist.  
- **GET /v1/media/playlist/previous/focus** — Focuses the previous media playlist.  
- **GET /v1/media/playlist/{playlist_id}** — Lists items in a media playlist.  
- **GET /v1/media/playlist/{playlist_id}/focus** — Focuses a media playlist.  
- **GET /v1/media/playlist/{playlist_id}/next/trigger** — Plays the next item.  
- **GET /v1/media/playlist/{playlist_id}/previous/trigger** — Plays the previous item.  
- **GET /v1/media/playlist/{playlist_id}/trigger** — Starts the playlist.  
- **GET /v1/media/playlist/{playlist_id}/updates** — Streams playlist updates.  
- **GET /v1/media/playlist/{playlist_id}/{media_id}/trigger** — Triggers a specific media item.  
- **GET /v1/media/playlists** — Lists all media playlists.  
- **GET /v1/media/{uuid}/thumbnail** — Returns a media thumbnail.

---

## Message API

- **DELETE /v1/message/{id}** — Deletes a message.  
- **GET /v1/message/{id}** — Returns message details.  
- **PUT /v1/message/{id}** — Updates a message.  
- **GET /v1/message/{id}/clear** — Hides a message.  
- **POST /v1/message/{id}/trigger** — Shows a message.  
- **GET /v1/messages** — Lists all messages.  
- **POST /v1/messages** — Creates a new message.

---

## Playlist API

_(Large section — all endpoints included)_

- **GET /v1/playlist/active** — Returns the active playlist.  
- **GET /v1/playlist/active/announcement/focus** — Focuses the active announcement playlist.  
- **GET /v1/playlist/active/announcement/trigger** — Triggers the first announcement item.  
- **GET /v1/playlist/active/announcement/{index}/thumbnail/{cue_index}** — Returns a cue thumbnail.  
- **GET /v1/playlist/active/announcement/{index}/timeline** — Returns timeline state.  
- **GET /v1/playlist/active/announcement/{index}/timeline/{operation}** — Performs a timeline operation.  
- **GET /v1/playlist/active/announcement/{index}/trigger** — Triggers an announcement item.  
- **GET /v1/playlist/active/announcement/{index}/{cue_index}/trigger** — Triggers a specific cue.  
- **GET /v1/playlist/active/presentation/focus** — Focuses the active presentation playlist.  
- **GET /v1/playlist/active/presentation/trigger** — Triggers the first presentation item.  
- **GET /v1/playlist/active/presentation/{index}/thumbnail/{cue_index}** — Returns a cue thumbnail.  
- **GET /v1/playlist/active/presentation/{index}/timeline** — Returns timeline state.  
- **GET /v1/playlist/active/presentation/{index}/timeline/{operation}** — Performs a timeline operation.  
- **GET /v1/playlist/active/presentation/{index}/trigger** — Triggers a presentation item.  
- **GET /v1/playlist/active/presentation/{index}/{cue_index}/trigger** — Triggers a specific cue.  
- **GET /v1/playlist/focused** — Returns the focused playlist.  
- **GET /v1/playlist/focused/next** — Returns the next item.  
- **GET /v1/playlist/focused/next/trigger** — Triggers the next item.  
- **GET /v1/playlist/focused/previous** — Returns the previous item.  
- **GET /v1/playlist/focused/previous/trigger** — Triggers the previous item.  
- **GET /v1/playlist/focused/trigger** — Triggers the first item.  
- **GET /v1/playlist/focused/{index}/timeline** — Returns timeline state.  
- **GET /v1/playlist/focused/{index}/timeline/{operation}** — Performs a timeline operation.  
- **GET /v1/playlist/focused/{index}/trigger** — Triggers an item.  
- **GET /v1/playlist/focused/{index}/{cue_index}/trigger** — Triggers a cue.  
- **GET /v1/playlist/next/focus** — Focuses the next playlist.  
- **GET /v1/playlist/previous/focus** — Focuses the previous playlist.  
- **GET /v1/playlist/{playlist_id}** — Lists playlist items.  
- **POST /v1/playlist/{playlist_id}** — Creates a playlist under another playlist.  
- **PUT /v1/playlist/{playlist_id}** — Updates a playlist.  
- **GET /v1/playlist/{playlist_id}/focus** — Focuses a playlist.  
- **GET /v1/playlist/{playlist_id}/next/trigger** — Triggers the next item.  
- **GET /v1/playlist/{playlist_id}/previous/trigger** — Triggers the previous item.  
- **GET /v1/playlist/{playlist_id}/trigger** — Triggers the first item.  
- **GET /v1/playlist/{playlist_id}/updates** — Streams playlist updates.  
- **GET /v1/playlist/{playlist_id}/{index}/thumbnail/{cue_index}** — Returns a cue thumbnail.  
- **GET /v1/playlist/{playlist_id}/{index}/trigger** — Triggers an item.  
- **GET /v1/playlist/{playlist_id}/{index}/{cue_index}/trigger** — Triggers a cue.  
- **GET /v1/playlists** — Lists all playlists.  
- **POST /v1/playlists** — Creates a new playlist.

---

## Presentation API

- **GET /v1/presentation/active** — Returns the active presentation.  
- **GET /v1/presentation/active/focus** — Focuses the active presentation.  
- **GET /v1/presentation/active/group/{group_id}/trigger** — Triggers a group.  
- **GET /v1/presentation/active/next/trigger** — Triggers the next cue.  
- **GET /v1/presentation/active/previous/trigger** — Triggers the previous cue.  
- **GET /v1/presentation/active/timeline** — Returns timeline state.  
- **GET /v1/presentation/active/timeline/{operation}** — Performs a timeline operation.  
- **GET /v1/presentation/active/trigger** — Restarts the active presentation.  
- **GET /v1/presentation/active/{index}/trigger** — Triggers a specific cue.  
- **GET /v1/presentation/chord_chart** — Returns the chord chart image.  
- **GET /v1/presentation/chord_chart/updates** — Streams chord chart updates.  
- **GET /v1/presentation/focused** — Returns the focused presentation.  
- **GET /v1/presentation/focused/group/{group_id}/trigger** — Triggers a group.  
- **GET /v1/presentation/focused/next/trigger** — Triggers the next cue.  
- **GET /v1/presentation/focused/previous/trigger** — Triggers the previous cue.  
- **GET /v1/presentation/focused/timeline** — Returns timeline state.  
- **GET /v1/presentation/focused/timeline/{operation}** — Performs a timeline operation.  
- **GET /v1/presentation/focused/trigger** — Triggers the focused presentation.  
- **GET /v1/presentation/focused/{index}/trigger** — Triggers a cue.  
- **GET /v1/presentation/next/focus** — Focuses the next presentation.  
- **GET /v1/presentation/previous/focus** — Focuses the previous presentation.  
- **GET /v1/presentation/slide_index** — Returns the current slide index.  
- **GET /v1/presentation/{uuid}** — Returns presentation details.  
- **GET /v1/presentation/{uuid}/focus** — Focuses a presentation.  
- **GET /v1/presentation/{uuid}/group/{group_id}/trigger** — Triggers a group.  
- **GET /v1/presentation/{uuid}/next/trigger** — Triggers the next cue.  
- **GET /v1/presentation/{uuid}/previous/trigger** — Triggers the previous cue.  
- **GET /v1/presentation/{uuid}/thumbnail/{index}** — Returns a cue thumbnail.  
- **GET /v1/presentation/{uuid}/timeline/{operation}** — Performs a timeline operation.  
- **GET /v1/presentation/{uuid}/trigger** — Triggers the presentation.  
- **GET /v1/presentation/{uuid}/{index}/trigger** — Triggers a cue.

---

Absolutely Shamir — picking up **right at Props** and continuing in the same **Style A** (compact developer‑friendly Markdown, one‑sentence description per endpoint).

Here you go.

---

# Props API

- **DELETE /v1/prop/{id}** — Deletes the specified prop.  
- **GET /v1/prop/{id}** — Retrieves details of a specific prop.  
- **PUT /v1/prop/{id}** — Updates the properties of a prop.  
- **GET /v1/prop/{id}/auto_clear/pause** — Pauses the auto‑clear timer for a prop.  
- **GET /v1/prop/{id}/auto_clear/resume** — Resumes the auto‑clear timer for a prop.  
- **GET /v1/prop/{id}/clear** — Clears (hides) the specified prop.  
- **GET /v1/prop/{id}/thumbnail** — Retrieves a thumbnail image of the prop.  
- **GET /v1/prop/{id}/trigger** — Triggers (shows) the specified prop.  

### Prop Collections

- **DELETE /v1/prop_collection/{id}** — Deletes a prop collection and all props inside it.  
- **GET /v1/prop_collection/{id}** — Retrieves details of a prop collection.  
- **PUT /v1/prop_collection/{id}** — Updates a prop collection.  
- **GET /v1/prop_collections** — Lists all prop collections.  
- **POST /v1/prop_collections** — Creates a new prop collection.  
- **GET /v1/props** — Lists all props.

---

# Stage API

- **DELETE /v1/stage/layout/{id}** — Deletes the specified stage layout.  
- **GET /v1/stage/layout/{id}/thumbnail** — Retrieves a thumbnail of the specified stage layout.  
- **GET /v1/stage/layout_map** — Returns the currently selected stage layout for each stage screen.  
- **PUT /v1/stage/layout_map** — Sets the stage layout for each stage screen.  
- **GET /v1/stage/layouts** — Lists all configured stage layouts.  
- **DELETE /v1/stage/message** — Hides the currently displayed stage message.  
- **GET /v1/stage/message** — Retrieves the currently active stage message.  
- **PUT /v1/stage/message** — Shows a stage message on the configured stage screens.  
- **GET /v1/stage/screen/{id}/layout** — Returns the current stage layout for a specific stage screen.  
- **GET /v1/stage/screen/{id}/layout/{layout_id}** — Sets a stage layout for a specific stage screen.  
- **GET /v1/stage/screens** — Lists all configured stage screens.

---

# Status API

- **GET /v1/status/audience_screens** — Retrieves the status of all audience screens.  
- **PUT /v1/status/audience_screens** — Updates the status of audience screens.  
- **GET /v1/status/layers** — Returns the status of all available layers.  
- **GET /v1/status/screens** — Returns details of all configured screens.  
- **GET /v1/status/slide** — Returns current and next slide text and image UUIDs.  
- **GET /v1/status/stage_screens** — Retrieves the status of all stage screens.  
- **PUT /v1/status/stage_screens** — Updates the status of stage screens.  
- **POST /v1/status/updates** — Combines multiple streaming endpoints into one aggregated stream.  
- **GET /version** — Returns general information about the running ProPresenter instance.

---

# Theme API

- **GET /v1/theme/{id}** — Retrieves details of a theme and its slides.  
- **GET /v1/theme/{id}/slides/{theme_slide}** — Retrieves details of a specific theme slide.  
- **PUT /v1/theme/{id}/slides/{theme_slide}** — Updates a specific theme slide.  
- **GET /v1/theme/{id}/slides/{theme_slide}/thumbnail** — Retrieves a thumbnail of a theme slide.  
- **GET /v1/themes** — Lists all themes and their slides.

---

# Timer API

- **GET /v1/timer/system_time** — Returns the current system time.  
- **GET /v1/timer/video_countdown** — Returns the current video countdown timer value.  
- **DELETE /v1/timer/{id}** — Deletes a timer.  
- **GET /v1/timer/{id}** — Retrieves details of a specific timer.  
- **PUT /v1/timer/{id}** — Updates a timer.  
- **GET /v1/timer/{id}/increment/{time}** — Adjusts the running timer by a specified amount.  
- **GET /v1/timer/{id}/{operation}** — Performs an operation (start/stop/reset) on a timer.  
- **PUT /v1/timer/{id}/{operation}** — Updates a timer and performs an operation.  
- **GET /v1/timers** — Lists all configured timers.  
- **POST /v1/timers** — Creates a new timer.  
- **GET /v1/timers/current** — Returns the current time for all timers.  
- **GET /v1/timers/{operation}** — Performs an operation (start/stop/reset) on all timers.

---

# Transport API

- **DELETE /v1/transport/{layer}/auto_advance** — Cancels auto‑advance for a layer.  
- **GET /v1/transport/{layer}/auto_advance** — Returns auto‑advance status for a layer.  
- **GET /v1/transport/{layer}/current** — Returns details of the currently playing content on a layer.  
- **GET /v1/transport/{layer}/go_to_end** — Jumps to the end of the content on a layer.  
- **GET /v1/transport/{layer}/pause** — Pauses content on a layer.  
- **GET /v1/transport/{layer}/play** — Plays content on a layer.  
- **GET /v1/transport/{layer}/skip_backward/{time}** — Skips backward by a number of seconds.  
- **GET /v1/transport/{layer}/skip_forward/{time}** — Skips forward by a number of seconds.  
- **GET /v1/transport/{layer}/time** — Returns the current transport time.  
- **PUT /v1/transport/{layer}/time** — Moves to a specific time in the content.

---

# Trigger API

- **GET /v1/trigger/audio/next** — Triggers the next audio item.  
- **GET /v1/trigger/audio/previous** — Triggers the previous audio item.  
- **GET /v1/trigger/media/next** — Triggers the next media item.  
- **GET /v1/trigger/media/previous** — Triggers the previous media item.  
- **GET /v1/trigger/next** — Triggers the next cue or item in the active playlist or library.  
- **GET /v1/trigger/previous** — Triggers the previous cue or item in the active playlist or library.

---

# Video Input API

- **GET /v1/video_inputs** — Returns the list of video inputs.  
- **GET /v1/video_inputs/{id}/trigger** — Triggers a video input from the video input playlist.

---