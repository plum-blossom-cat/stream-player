// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
  namespace App {}

  interface StreamFormData {
    streamUrl: string;
    streamType: string;
    cookie: string;
    referer: string;
    origin: string;
    userAgent: string;
    drmScheme: string;
    clearKey: string;
    licenseUrl: string;
    licenseHeaders: string;
    certificateUrl: string;
    certificateHeaders: string;
    requestHeaders: string;
    shakaConfig: string;
  }
}

export {};
