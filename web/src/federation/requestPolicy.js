export const utf8Bytes = value => new TextEncoder().encode(value).length;
export const definitiveRejection = error => [400,403,404,409].includes(error?.status) && error?.code !== 'transfer_uncertain';
export const validBoundedText = (value, maximum) => value.trim().length > 0 && !value.includes('\0') && utf8Bytes(value) <= maximum;
