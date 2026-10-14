import { getAllCobaltUrls } from "../src/config.js";
import { fetchJsonWithTimeout } from "../src/utils/http.js";
const urls = [
  "https://www.instagram.com/reel/Dd-4gKENRms/",
  "https://www.instagram.com/reel/DeXA5froeiC/",
];
for (const instance of getAllCobaltUrls()) {
  for (const url of urls) {
    const started = Date.now();
    try {
      const { response, data } = await fetchJsonWithTimeout(instance + "/", {
        method: "POST",
        redirect: "error",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url,
          videoQuality: "max",
          downloadMode: "auto",
          localProcessing: "disabled",
        }),
        timeoutMs: 45000,
      });
      const info = data as any;
      console.log(
        JSON.stringify({
          instance,
          url,
          elapsed_ms: Date.now() - started,
          http: response.status,
          status: info?.status,
          error: info?.error?.code,
          hasMedia: !!info?.url,
        }),
      );
    } catch {
      console.log(
        JSON.stringify({
          instance,
          url,
          elapsed_ms: Date.now() - started,
          failed: true,
        }),
      );
    }
  }
}
