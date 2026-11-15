# Frontend interaction notes

References: reference/picture-1.png (text channels), picture-2.png (voice stage and side chat), picture-3.png (account overlay). Preserve black surfaces, compact sidebar, selected channel highlight and blue voice-stage gradient.

Documentation: https://docs.discord.com/developers/platform/server-and-channel-management and https://docs.discord.com/developers/platform/components . These describe app APIs, not Discord client source. This implementation uses its own Rust backend, not Discord authentication or APIs.

Authenticated users can create groups, join by invite, create text or voice channels as owner, open direct/group conversations and send messages. The backend enforces membership and ownership. New channels and joined groups become selected. Drafts remain separate in memory per destination; an in-flight send does not erase another channel draft or newer text. Enter sends; Shift+Enter inserts a newline. Modal forms support Escape and focus containment. Group conversations allow up to nine other members. Voice channels show their text conversation alongside the stage; audio transport is not implemented.

Native analysis: Craft Anything builtin decompiler inspected the local Discord.exe (evidence ev_d5fb3f0d6dbdf0bb974fef3698c95f3ac266064c4c2ca2da7777d964c3fbfd20). Ghidra unavailable; this native result does not establish frontend behavior. Runtime equivalence with Discord remains unverified.
