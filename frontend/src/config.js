export const GAS_URL=(import.meta.env.VITE_GAS_URL||'').trim();
export const VERSION='1.0.0';
export const IS_CONFIGURED=/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(GAS_URL);
export const MAX_PHOTO_BYTES=1048576;
