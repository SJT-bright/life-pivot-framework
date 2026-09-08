export type RecordKind =
  | "fact-event"
  | "descriptive-content"
  | "definition"
  | "activated-history";

export type MutationPolicy =
  | "append-correction"
  | "editable-with-revision"
  | "versioned-definition"
  | "immutable-history";
