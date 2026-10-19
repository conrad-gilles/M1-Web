## Sharing Platform

Based on current application
Supports multiple media types (audi, video, maybe something else also?)
Files stored once on the server (currently mongo db?)
Multiple users can connect and access the same file or files
Files are streamed to one or multiple users at the same time (because video for example are too large to be downloaded once)
Option to sync streaming of same file between users
This sync will at the beginnng be done using the backend server(if I understood correctly we already have a server in node I believe, so this is the easiest starting point)
(When this PoC works deploy for free on render maybe? and maybe github pages?)
After maybe implement a serverless structure where users individually save the media files locally and can sync playback over a peer to peer infrastructure (Proffessor mentioned PeerJS WebRTC)
for this syncing to work maybe files need to be the same lenght? Or not? Maybe artificial constraints such as same metadata?
Maybe users can or have to deploy their own server?
