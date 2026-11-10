// ============================================================
// 登録ゲート (D15 / Emumet RegistrationGate tag) — クライアント契約
// DTO は bff/schema.graphql と同じ camelCase 形状。real (registration-gate-real.ts) が
// REST (snake_case) から変換し、mock (registration-gate-mock.ts) が同一契約で実装する。
//
// 状態語彙は kernel 側で固定されており、BFF/UI はこれらを混同しない:
//   decision   ACCEPTING / TEMPORARY_REJECT (自動復旧) / STOPPED (設定喪失ラッチ・手動再開が必要) / ADMIN_CLOSED
//   override   On/Off は decision と独立 (閉鎖中でも override 値は保持される)
//   防御低下   degradedProtections (設定済みだが検証 API が応答しない対策)
// 「状態」は GET の結果、「エラー」は下記の例外クラスで別の型として表す。
// E15a は control plane のみで、実 Kratos 登録をまだ遮断も許可もしない (E15d で接続)。
// ============================================================

export type RegistrationDecision = "ACCEPTING" | "ADMIN_CLOSED" | "STOPPED" | "TEMPORARY_REJECT";
export type RegistrationAdminState = "OPEN" | "CLOSED";
export type RegistrationHealthEpisode = "NONE" | "OUTAGE" | "DEGRADED";
export type RegistrationProtection = "EMAIL" | "BOT";
export type RegistrationProbeStatus = "HEALTHY" | "UNHEALTHY" | "UNKNOWN";
export type RegistrationGateEventKind =
  | "OUTAGE_STARTED"
  | "OUTAGE_RECOVERED"
  | "PROTECTION_DEGRADED"
  | "PROTECTION_LOST_STOPPED"
  | "OVERRIDE_STARTED"
  | "OVERRIDE_REVOKED";

export type RegistrationProtectionObservation = {
  readonly configured: boolean;
  readonly probe: RegistrationProbeStatus;
};

export type RegistrationObservation = {
  readonly email: RegistrationProtectionObservation;
  readonly bot: RegistrationProtectionObservation;
};

export type RegistrationOverride = {
  readonly active: boolean;
  readonly activatedBy: string | null;
  readonly activatedAt: string | null;
};

export type RegistrationGate = {
  /** 楽観ロック用。変更系操作はこの値を送り、不一致は REVISION_CONFLICT (409) になる */
  readonly revision: number;
  readonly adminState: RegistrationAdminState;
  readonly decision: RegistrationDecision;
  readonly accepting: boolean;
  /** decision が STOPPED (設定喪失ラッチ) のとき true。復旧しても自動再開しない */
  readonly requiresManualResume: boolean;
  readonly configLostLatch: boolean;
  readonly healthEpisode: RegistrationHealthEpisode;
  /** 登録時に課す対策 (検証 API が実際に応答した対策のみ) */
  readonly enforcedProtections: readonly RegistrationProtection[];
  /** 防御低下: 設定済みだが検証 API が応答しない対策 */
  readonly degradedProtections: readonly RegistrationProtection[];
  readonly override: RegistrationOverride;
  readonly observation: RegistrationObservation;
  readonly updatedAt: string;
};

export type RegistrationGateNotification = {
  readonly id: string;
  readonly kind: RegistrationGateEventKind;
  readonly revision: number;
  /** override の開始・解除を実行した管理者 (auth account ID)。他の種別は null */
  readonly actor: string | null;
  readonly observation: RegistrationObservation;
  readonly createdAt: string;
  /** 呼び出した管理者自身の既読状態 (管理者間で共有されない) */
  readonly read: boolean;
  readonly readAt: string | null;
};

export type RegistrationGateNotificationPage = {
  readonly notifications: readonly RegistrationGateNotification[];
  /** 呼び出した管理者自身の未読件数 (ページ範囲ではなく全体) */
  readonly unreadCount: number;
  /** 次ページ取得用の `before`。最後のページでは null */
  readonly nextCursor: string | null;
};

export type RegistrationGateNotificationQuery = {
  /** 1〜100 (既定 50) */
  readonly limit?: number;
  /** 前ページ最後の通知イベント ID。これより古いものを返す */
  readonly before?: string;
};

/** 認可の正本は Emumet API (instance:administrate)。BFF は権限を判断せず 401/403 をそのまま区別して返す */
export interface RegistrationGateClient {
  getRegistrationGate(): Promise<RegistrationGate>;
  /** 開放。設定喪失で停止中の手動再開も同じ操作 (最低条件を満たさなければ 422) */
  openRegistrationGate(revision: number): Promise<RegistrationGate>;
  closeRegistrationGate(revision: number): Promise<RegistrationGate>;
  /** acknowledgeWarning=false は API が 400 で拒否する (BFF は握りつぶさず転送する) */
  enableRegistrationGateOverride(revision: number, acknowledgeWarning: boolean): Promise<RegistrationGate>;
  revokeRegistrationGateOverride(revision: number): Promise<RegistrationGate>;
  listRegistrationGateNotifications(query?: RegistrationGateNotificationQuery): Promise<RegistrationGateNotificationPage>;
  countUnreadRegistrationGateNotifications(): Promise<number>;
  /** 戻り値は既読化後の未読件数 */
  markRegistrationGateNotificationsRead(eventIds: readonly string[]): Promise<number>;
  markAllRegistrationGateNotificationsRead(): Promise<number>;
}

/**
 * Emumet API に到達できない / 応答が時間内に返らない (接続失敗・タイムアウト)。
 * 一時障害として扱い、権限・競合・前提条件エラーとは別のエラーコードになる。
 */
export class EmumetUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "EmumetUnavailableError";
  }
}

/**
 * Emumet API が OpenAPI 契約に反する 2xx 応答を返した (語彙外の値・必須欠落・型違い・不整合)。
 * 成功として扱わず fail closed にする。応答本文は含めない。
 */
export class EmumetInvalidResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmumetInvalidResponseError";
  }
}
