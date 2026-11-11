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
// 判定は E15d で実 Kratos 登録 (pre-persist hook) に適用される。適用証明の喪失も停止ラッチ (enforcementLostLatch) になる。
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
  | "OVERRIDE_REVOKED"
  /** E15d: 登録の保護 (Kratos hook) の適用証明が失われて停止した。復旧後も手動再開が必要 */
  | "ENFORCEMENT_LOST_STOPPED"
  | "ENFORCEMENT_RESTORED";

export type RegistrationProtectionObservation = {
  readonly configured: boolean;
  readonly probe: RegistrationProbeStatus;
};

export type RegistrationObservation = {
  /** E15d: 登録の保護 (Kratos pre-persist hook) が現在の deployment で適用されている証明。false の間は開放・再開・override が 422 */
  readonly enforcementVerified: boolean;
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
  /** E15d: 適用証明の喪失による停止ラッチ。override 中でも decision は STOPPED になり、復旧後も手動再開が必要 */
  readonly enforcementLostLatch: boolean;
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

// ---- 保護の readiness (E15c: GET /protections・POST /protections/{protection}/verify) ----

/**
 * 現在時刻での評価。OPERATIONAL は現在の設定世代に結び付いた実検証の成功が新鮮な間だけ。
 * UNVERIFIED は未検証・設定変更後・成功期限切れ・probe 停止を含む。
 */
export type RegistrationProtectionStatus = "CONFIGURATION_INVALID" | "OPERATIONAL" | "TEMPORARILY_UNAVAILABLE" | "UNVERIFIED";

export type RegistrationProtectionReadiness = {
  readonly protection: RegistrationProtection;
  /** 設定が有効か (未設定・明示無効は false) */
  readonly enabled: boolean;
  readonly status: RegistrationProtectionStatus;
  /** 評価の理由 (Emumet の固定語彙。secret を含まない)。未知の値もそのまま通し、表示側が対応表に無ければ出さない */
  readonly reason: string;
  readonly checkedAt: string | null;
  readonly validUntil: string | null;
};

export type RegistrationProtectionVerifyOutcome =
  | "BUSINESS_SUCCESS"
  | "ACCEPTED"
  | "CONFIGURATION_INVALID"
  | "ATTEMPT_REJECTED"
  | "TEMPORARILY_UNAVAILABLE";

export type RegistrationProtectionVerifyDisposition = "COMPLETED" | "PENDING_CONFIRMATION" | "CANARY_NOT_CONFIGURED";

export type RegistrationProtectionVerification = {
  readonly outcome: RegistrationProtectionVerifyOutcome;
  readonly reason: string;
  /** readiness へ記録したか (当該試行だけの拒否は記録しない) */
  readonly recorded: boolean;
  readonly disposition: RegistrationProtectionVerifyDisposition;
  readonly readiness: RegistrationProtectionReadiness;
};

// ---- Webhook 配送状態 (E15w: GET /webhook・POST /webhook/test・POST /webhook/retry) ----
// endpoint と secret はサーバー設定のみ。BFF は宛先 host 以外 (URL 全体・secret・署名) を一切扱わない。

export type RegistrationWebhookConfiguration = "NOT_CONFIGURED" | "MISCONFIGURED" | "CONFIGURED";
export type RegistrationWebhookDeliveryStatus = "PENDING" | "IN_FLIGHT" | "RETRYING" | "DELIVERED" | "FAILED";

export type RegistrationWebhookDelivery = {
  /** 通知イベント ID (再試行・再送で不変) */
  readonly eventId: string;
  readonly eventType: RegistrationGateEventKind;
  readonly status: RegistrationWebhookDeliveryStatus;
  readonly attemptCount: number;
  readonly createdAt: string;
  readonly lastAttemptAt: string | null;
  readonly deliveredAt: string | null;
  /** 固定語彙の結果分類 (timeout / http_server_error など)。宛先 URL・応答本文は含まない */
  readonly lastResult: string | null;
  /** failed のときの理由 (permanent_error / retries_exhausted) */
  readonly failureReason: string | null;
};

export type RegistrationWebhookCounts = {
  readonly pending: number;
  readonly inFlight: number;
  readonly retrying: number;
  readonly delivered: number;
  readonly failed: number;
};

export type RegistrationWebhookStatus = {
  readonly configuration: RegistrationWebhookConfiguration;
  /** MISCONFIGURED のときの不備の分類 (固定語彙) */
  readonly issue: string | null;
  /** 宛先の host 部分のみ */
  readonly destinationHost: string | null;
  readonly counts: RegistrationWebhookCounts;
  readonly lastSuccessAt: string | null;
  readonly lastFailureAt: string | null;
  /** 新しい順の直近の配送記録 */
  readonly recentDeliveries: readonly RegistrationWebhookDelivery[];
};

export type RegistrationWebhookTestResult = {
  readonly delivered: boolean;
  readonly result: string;
  readonly httpStatus: number | null;
  readonly attemptedAt: string;
};

// ---- 呼び出し者 (GET /api/v1/me) ----

export type InstanceRole = "ADMIN" | "MODERATOR";

/** UI の出し分け (管理画面の導線) のヒント。権限判断の正本ではない (各管理 API が 401/403 を返す) */
export type Viewer = {
  readonly accountId: string;
  readonly instanceRoles: readonly InstanceRole[];
};

/**
 * Webhook が未設定・設定不備でテスト送信できない (POST /webhook/test の 409)。
 * revision 競合 (REVISION_CONFLICT) とは別のエラーとして扱う。
 */
export class EmumetWebhookUnavailableError extends Error {
  constructor() {
    super("registration gate webhook is not configured or misconfigured");
    this.name = "EmumetWebhookUnavailableError";
  }
}

/** 再試行対象の failed 配送が無い (POST /webhook/retry の 404)・未知の保護 (verify の 404) */
export class EmumetRegistrationTargetNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmumetRegistrationTargetNotFoundError";
  }
}

/** 認可の正本は Emumet API (instance:administrate)。BFF は権限を判断せず 401/403 をそのまま区別して返す */
export interface RegistrationGateClient {
  /** GET /api/v1/me。管理者向け UI の導線を出すかのヒント */
  getViewer(): Promise<Viewer>;
  listRegistrationProtections(): Promise<readonly RegistrationProtectionReadiness[]>;
  /** 入力なしの検証 (bot は secret の負の probe、email は canary mailbox への送信) */
  verifyRegistrationProtection(protection: RegistrationProtection): Promise<RegistrationProtectionVerification>;
  getRegistrationWebhookStatus(): Promise<RegistrationWebhookStatus>;
  sendRegistrationWebhookTest(): Promise<RegistrationWebhookTestResult>;
  /** eventId 指定でその failed 配送だけ、省略で failed 全件を再キューする。戻り値は再キュー件数 */
  retryRegistrationWebhook(eventId?: string): Promise<number>;
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
