// Allocate the immutable proposal only after validating the normalized audience.
// A failed local check cannot leave a retry lock for a request never sent.
export function prepareGoldProposal(audience, allocate) {
  if (!Array.isArray(audience)) throw Error('Choose between 1 and 100 people for the gold audience.');
  const unique = [...new Set(audience)];
  if (unique.length < 1 || unique.length > 100) throw Error('Choose between 1 and 100 people for the gold audience.');
  return allocate(unique);
}
