import {
  dataChannelControlSchema,
  type PublicFile,
} from "@directdrop/protocol";
import {
  ProgressMeter,
  throttle,
  type ProgressSnapshot,
} from "@directdrop/shared";
import type { SavePlan } from "./save-plan";

export function attachReceiverChannel(options: {
  channel: RTCDataChannel;
  files: PublicFile[];
  savePlan: SavePlan;
  onProgress: (snapshot: ProgressSnapshot) => void;
  onComplete: () => void;
  onError: (error: Error) => void;
}) {
  const { channel, files, savePlan } = options;
  const total = files.reduce((sum, file) => sum + file.size, 0);
  const meter = new ProgressMeter();
  const publish = throttle(options.onProgress, 200);
  let transferred = 0;
  let chain = Promise.resolve();

  channel.binaryType = "arraybuffer";
  channel.onmessage = (event) => {
    chain = chain
      .then(async () => {
        if (typeof event.data === "string") {
          const control = dataChannelControlSchema.parse(
            JSON.parse(event.data),
          );
          if (control.type === "FILE_START") await savePlan.startFile(control);
          else if (control.type === "FILE_END") await savePlan.endFile();
          else if (control.type === "TRANSFER_COMPLETE") {
            await savePlan.complete();
            options.onComplete();
          } else if (control.type === "TRANSFER_ERROR")
            throw new Error(control.message);
          return;
        }
        const chunk =
          event.data instanceof ArrayBuffer
            ? event.data
            : await (event.data as Blob).arrayBuffer();
        await savePlan.write(chunk);
        transferred += chunk.byteLength;
        publish(meter.sample(transferred, total));
      })
      .catch(async (error: unknown) => {
        await savePlan.abort(error);
        options.onError(
          error instanceof Error ? error : new Error(String(error)),
        );
      });
  };
}
