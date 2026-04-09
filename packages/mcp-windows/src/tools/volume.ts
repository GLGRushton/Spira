import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runPs } from "../util/powershell.js";
import { errorResult, successResult } from "../util/results.js";
import { EmptySchema, SetVolumeSchema } from "../util/validation.js";

// TODO: Cache AudioEndpoint in a compiled DLL and switch to Add-Type -Path.
// runPs() starts a new PowerShell process per call, so the inline C# is recompiled every time.
const AUDIO_ENDPOINT_SCRIPT = String.raw`
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {
    int NotImpl1();
    [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice ppDevice);
}

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
class MMDeviceEnumeratorComObject {
}

[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
    [PreserveSig] int Activate(ref Guid id, int clsCtx, IntPtr activationParams, out IAudioEndpointVolume aev);
    int NotImpl1();
    int NotImpl2();
}

[ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
    int NotImpl1();
    int NotImpl2();
    int NotImpl3();
    int NotImpl4();
    [PreserveSig] int SetMasterVolumeLevelScalar(float fLevel, Guid pguidEventContext);
    int NotImpl5();
    [PreserveSig] int GetMasterVolumeLevelScalar(out float pfLevel);
    int NotImpl6();
    int NotImpl7();
    int NotImpl8();
    int NotImpl9();
    [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, Guid pguidEventContext);
    [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool pbMute);
}

public class AudioEndpoint {
    static readonly Guid IID_IAudioEndpointVolume = typeof(IAudioEndpointVolume).GUID;

    static IAudioEndpointVolume GetEndpoint() {
        var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
        IMMDevice device;
        enumerator.GetDefaultAudioEndpoint(0, 1, out device);
        IAudioEndpointVolume endpoint;
        var iid = IID_IAudioEndpointVolume;
        device.Activate(ref iid, 23, IntPtr.Zero, out endpoint);
        return endpoint;
    }

    public static float GetVolume() {
        float volume;
        GetEndpoint().GetMasterVolumeLevelScalar(out volume);
        return volume * 100f;
    }

    public static void SetVolume(float percent) {
        GetEndpoint().SetMasterVolumeLevelScalar(percent / 100f, Guid.Empty);
    }

    public static bool GetMute() {
        bool muted;
        GetEndpoint().GetMute(out muted);
        return muted;
    }

    public static void SetMute(bool muted) {
        GetEndpoint().SetMute(muted, Guid.Empty);
    }
}
'@
`;

const readVolumeState = async (): Promise<{ level: number; muted: boolean }> => {
  const { stdout } = await runPs(`
${AUDIO_ENDPOINT_SCRIPT}
$result = @{
  level = [int][Math]::Round([AudioEndpoint]::GetVolume())
  muted = [AudioEndpoint]::GetMute()
}
$result | ConvertTo-Json -Compress
`);

  return JSON.parse(stdout) as { level: number; muted: boolean };
};

export const registerVolumeTools = (server: McpServer): void => {
  server.registerTool(
    "system_get_volume",
    {
      description: "Get the current Windows master volume and mute state.",
      inputSchema: EmptySchema,
    },
    async () => {
      try {
        const state = await readVolumeState();
        return successResult(state);
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Failed to get system volume.");
      }
    },
  );

  server.registerTool(
    "system_set_volume",
    {
      description: "Set the Windows master volume to a percentage between 0 and 100.",
      inputSchema: SetVolumeSchema,
    },
    async ({ level }) => {
      try {
        await runPs(`
${AUDIO_ENDPOINT_SCRIPT}
[AudioEndpoint]::SetVolume(${level})
`);

        return successResult({ success: true, level }, `Volume set to ${level}%.`);
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Failed to set system volume.");
      }
    },
  );

  server.registerTool(
    "system_toggle_mute",
    {
      description: "Toggle the Windows master mute state.",
      inputSchema: EmptySchema,
    },
    async () => {
      try {
        const { stdout } = await runPs(`
${AUDIO_ENDPOINT_SCRIPT}
$current = [AudioEndpoint]::GetMute()
[AudioEndpoint]::SetMute(-not $current)
$result = @{
  muted = [AudioEndpoint]::GetMute()
  level = [int][Math]::Round([AudioEndpoint]::GetVolume())
}
$result | ConvertTo-Json -Compress
`);

        const state = JSON.parse(stdout) as { level: number; muted: boolean };
        return successResult(state, state.muted ? "System muted." : "System unmuted.");
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Failed to toggle mute.");
      }
    },
  );
};
