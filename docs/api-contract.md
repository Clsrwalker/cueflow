# CueFlow API Contract

## REST API

`POST /conversations`

Creates a conversation.

Response:

```json
{
  "conversation": {
    "conversationId": "conv_001",
    "userId": "demo-user",
    "status": "ACTIVE",
    "startedAt": "2026-06-16T10:00:00.000Z",
    "endedAt": null,
    "cueCount": 0,
    "summaryStatus": "NOT_STARTED"
  }
}
```

`GET /conversations`

Lists conversation history for a user. Optional query: `userId`.

`GET /conversations/{conversationId}`

Returns conversation metadata.

`GET /conversations/{conversationId}/cues`

Returns saved cue cards for a conversation.

`POST /conversations/{conversationId}/end`

Marks the conversation ended, stores the full transcript object, and enqueues summary generation.

Response fields:
- `conversation`
- `transcriptObjectKey`
- `summaryJobEnqueued`
- `summaryJob`

`GET /conversations/{conversationId}/summary`

Returns the final structured summary when ready. Before worker completion, returns a `SUMMARY_NOT_READY` error.

`POST /demo/replay`

Reserved for an optional server-side replay trigger. The local UI already includes client-side demo replay.

## WebSocket API

`$connect`

Query parameters:
- `conversationId`
- `userId` optional

Stores a connection record scoped to the conversation.

`$disconnect`

Deletes the connection record.

`sendTranscript`

Request:

```json
{
  "action": "sendTranscript",
  "conversationId": "conv_001",
  "chunkId": "000001",
  "speaker": "speaker_1",
  "text": "Should we use WebSocket or REST polling for real-time AI cues?",
  "clientTimestamp": "2026-06-16T10:00:05.000Z"
}
```

Ack event:

```json
{
  "eventType": "transcript.ack",
  "conversationId": "conv_001",
  "chunkId": "000001",
  "receivedAt": "2026-06-16T10:00:05.100Z"
}
```

Pushed cue event:

```json
{
  "eventType": "cue.created",
  "conversationId": "conv_001",
  "cue": {
    "cueId": "cue_001",
    "type": "DECISION",
    "title": "Architecture decision",
    "shortText": "The transcript discusses alternatives or a cloud architecture choice.",
    "detailText": "Use WebSocket for real-time cue delivery and REST for non-real-time history and summary retrieval."
  }
}
```

`ping`

Returns and pushes:

```json
{
  "eventType": "pong",
  "receivedAt": "2026-06-16T10:00:06.000Z"
}
```

`clientAckCue`

Request:

```json
{
  "action": "clientAckCue",
  "conversationId": "conv_001",
  "cueId": "cue_001"
}
```

Summary ready event:

```json
{
  "eventType": "summary.ready",
  "conversationId": "conv_001",
  "summaryStatus": "READY"
}
```
