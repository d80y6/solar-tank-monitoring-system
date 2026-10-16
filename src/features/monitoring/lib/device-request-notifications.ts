import {
  buildAdminTelegramUrl,
  sendAdminTelegramNotification,
  type AdminTelegramNotifyResult,
} from "@/features/auth/lib/admin-telegram-notifications";
import type { MonitoringDeviceRequest } from "../types/monitoring";

function formatOptionalCoordinate(value: number | undefined): string {
  return typeof value === "number" ? String(value) : "-";
}

function buildAdminRequestUrl(requestId: string): string {
  return buildAdminTelegramUrl("/dashboard/admin/device-requests", {
    request: requestId,
  });
}

export async function notifyAdminsDeviceRequestCreated(
  request: MonitoringDeviceRequest,
): Promise<AdminTelegramNotifyResult> {
  const adminUrl = buildAdminRequestUrl(request.id);
  const text = [
    "New FTM device request",
    "",
    `Request code: ${request.requestCode}`,
    `STO: ${request.siteName}`,
    `Regional: ${request.regionalLabel}`,
    `Territory: ${request.wilayahLabel}`,
    `Area: ${request.areaLabel}`,
    `Device: ${request.deviceCode}`,
    `Tank: ${request.capacityLiter} L`,
    `Coordinates: ${formatOptionalCoordinate(request.latitude)}, ${formatOptionalCoordinate(request.longitude)}`,
    `Requester: ${request.requesterEmail}`,
    "",
    "Admin needs to review the data via the web page before the firmware package is created.",
    adminUrl,
  ].join("\n");

  return sendAdminTelegramNotification(text, { topic: "new-device" });
}
