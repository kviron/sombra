const empty: never[] = [];

/** The singular field is the first file on new servers and the only file on older ones. */
export function getMessageAttachments<T>(message: {attachments?: T[]; attachment?: T}): T[] {
 return message.attachments?.length ? message.attachments : message.attachment ? [message.attachment] : empty;
}

export function albumSummary(message: {attachments?: unknown[]}) {
 return message.attachments && message.attachments.length > 1 ? `Вложений: ${message.attachments.length}` : '';
}
