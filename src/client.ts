import { CrunchyrollApiError, CrunchyrollAuthError, CrunchyrollValidationError } from "./errors.js";
import { ensureRecord, getBoolean, getNumber, getString, isRecord, requireString } from "./guards.js";
import type {
  AnonymousTokenResponse,
  ApiListResponse,
  AuthSession,
  CookieAuthInput,
  CookieTokenResponse,
  CrunchyListItemsQuery,
  CrunchyListItemsResponse,
  CrunchyListsResponse,
  CrunchyrollClientOptions,
  CurrentlyWatchingResponse,
  EpisodeInfo,
  SeasonEpisodesQuery,
  SeasonEpisodesResponse,
  WatchHistoryEntry,
  WatchHistoryQuery,
  WatchHistoryResponse,
  WatchlistQuery,
  WatchlistResponse,
} from "./types.js";

type QueryValue = string | number | boolean;

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  query?: Record<string, QueryValue | undefined>;
  body?: BodyInit | null;
  headers?: HeadersInit;
  useBearerAuth?: boolean;
  useSessionCookie?: boolean;
  timeoutMs?: number;
};

const DEFAULT_BASE_URL = "https://beta-api.crunchyroll.com";
const DEFAULT_LOCALE = "en-US";
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_ANONYMOUS_BASIC_AUTH = "Basic Y3Jfd2ViOg==";
const DEFAULT_ETP_RT_COOKIE_BASIC_AUTH = "Basic bm9haWhkZXZtXzZpeWcwYThsMHE6";
const DEFAULT_DEVICE_TYPE = "Chrome on Android";
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36";
const DEFAULT_CRUNCHYROLL_HOST = "beta-api.crunchyroll.com";

export class CrunchyrollClient {
  private readonly baseUrl: URL;
  private readonly locale: string;
  private readonly timeoutMs: number;
  private readonly userAgent: string;
  private readonly fetchImpl: typeof fetch;
  private readonly anonymousBasicAuth: string;
  private readonly etpRtCookieBasicAuth: string;
  private readonly defaultDeviceType: string;
  private readonly sendCookieWithContentRequests: boolean;
  private readonly allowCookieOnCustomBaseUrl: boolean;
  private session: AuthSession | null = null;

  public constructor(options: CrunchyrollClientOptions = {}) {
    this.baseUrl = this.parseBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);
    this.locale = options.locale ?? DEFAULT_LOCALE;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    this.fetchImpl = options.fetchImpl ?? this.getGlobalFetch();
    this.anonymousBasicAuth = this.validateBasicAuth(
      options.anonymousBasicAuth ?? DEFAULT_ANONYMOUS_BASIC_AUTH,
      "anonymousBasicAuth",
    );
    this.etpRtCookieBasicAuth = this.validateBasicAuth(
      options.etpRtCookieBasicAuth ?? DEFAULT_ETP_RT_COOKIE_BASIC_AUTH,
      "etpRtCookieBasicAuth",
    );
    this.defaultDeviceType = options.defaultDeviceType ?? DEFAULT_DEVICE_TYPE;
    this.sendCookieWithContentRequests = options.sendCookieWithContentRequests ?? true;
    this.allowCookieOnCustomBaseUrl = options.allowCookieOnCustomBaseUrl ?? false;
  }

  public setSession(session: AuthSession): void {
    const nextSession: AuthSession = {
      accessToken: session.accessToken,
      tokenType: session.tokenType,
    };

    if (session.expiresAt !== undefined) {
      nextSession.expiresAt = session.expiresAt;
    }

    if (session.refreshToken !== undefined) {
      nextSession.refreshToken = session.refreshToken;
    }

    if (session.profileId !== undefined) {
      nextSession.profileId = session.profileId;
    }

    if (session.accountId !== undefined) {
      nextSession.accountId = session.accountId;
    }

    if (session.cookie !== undefined) {
      nextSession.cookie = this.sanitizeCookie(session.cookie);
    }

    this.session = nextSession;
  }

  public getSession(): AuthSession | null {
    if (!this.session) {
      return null;
    }

    return { ...this.session };
  }

  public clearSession(): void {
    this.session = null;
  }

  public isAuthenticated(): boolean {
    return this.session !== null && this.session.accessToken.length > 0;
  }

  public async getAnonymousToken(): Promise<AnonymousTokenResponse> {
    const body = new URLSearchParams({ grant_type: "client_id" }).toString();

    const payload = await this.requestJson("/auth/v1/token", {
      method: "POST",
      useBearerAuth: false,
      useSessionCookie: false,
      headers: {
        authorization: this.anonymousBasicAuth,
        "content-type": "application/x-www-form-urlencoded",
      },
      body,
    });

    return this.parseAnonymousToken(payload);
  }

  public async authenticateWithRtCookie(input: CookieAuthInput): Promise<AuthSession> {
    this.ensureServerRuntime();

    const cookie = this.sanitizeCookie(input.cookie);
    if (!cookie.includes("etp_rt=")) {
      throw new CrunchyrollValidationError(
        "Cookie must include etp_rt. Pass the complete Crunchyroll cookie string from a logged-in user session.",
      );
    }

    const authHeader = this.validateBasicAuth(input.basicAuth ?? this.etpRtCookieBasicAuth, "basicAuth");
    const deviceId = input.deviceId ?? this.makeDeviceId();
    const deviceType = input.deviceType ?? this.defaultDeviceType;

    const body = new URLSearchParams({
      device_type: deviceType,
      device_id: deviceId,
      grant_type: "etp_rt_cookie",
    }).toString();

    const payload = await this.requestJson("/auth/v1/token", {
      method: "POST",
      useBearerAuth: false,
      useSessionCookie: false,
      headers: {
        authorization: authHeader,
        "content-type": "application/x-www-form-urlencoded",
        cookie,
      },
      body,
    });

    const token = this.parseCookieToken(payload);
    const expiresAt = Date.now() + token.expires_in * 1000;
    const session: AuthSession = {
      accessToken: token.access_token,
      tokenType: token.token_type,
      expiresAt,
      cookie,
    };

    if (token.refresh_token !== undefined) {
      session.refreshToken = token.refresh_token;
    }

    if (token.profile_id !== undefined) {
      session.profileId = token.profile_id;
    }

    if (token.account_id !== undefined) {
      session.accountId = token.account_id;
    }

    this.session = session;
    return { ...session };
  }

  public async getWatchlist(query: WatchlistQuery = {}): Promise<WatchlistResponse> {
    const profileId = this.requireProfileId();
    const payload = await this.requestJson(`/content/v2/discover/${encodeURIComponent(profileId)}/watchlist`, {
      query: this.withLocale(query),
      useSessionCookie: this.sendCookieWithContentRequests,
    });

    return this.parseListResponse(payload, "watchlist");
  }

  public async getWatchHistory(query: WatchHistoryQuery = {}): Promise<WatchHistoryResponse> {
    const accountId = this.requireAccountIdOrProfileId();
    const payload = await this.requestJson(`/content/v2/${encodeURIComponent(accountId)}/watch-history`, {
      query: this.withLocale(query),
      useSessionCookie: this.sendCookieWithContentRequests,
    });

    return this.parseListResponse(payload, "watch history");
  }

  public async getHistory(query: WatchHistoryQuery = {}): Promise<WatchHistoryResponse> {
    return this.getWatchHistory(query);
  }

  public async getWatchedAnime(query: WatchHistoryQuery = {}): Promise<WatchHistoryResponse> {
    return this.getWatchHistory(query);
  }

  public async getCurrentlyWatching(query: WatchHistoryQuery = {}): Promise<CurrentlyWatchingResponse> {
    const history = await this.getWatchHistory(query);
    const filteredData = history.data.filter((entry) => this.looksInProgress(entry));

    return {
      ...history,
      data: filteredData,
      filtered_from_total: history.data.length,
    };
  }

  public async getCrunchylists(): Promise<CrunchyListsResponse> {
    const accountId = this.requireAccountIdOrProfileId();
    const payload = await this.requestJson(`/content/v2/${encodeURIComponent(accountId)}/custom-lists`, {
      query: this.withLocale({}),
      useSessionCookie: this.sendCookieWithContentRequests,
    });

    return this.parseListResponse(payload, "custom lists");
  }

  public async getCrunchylistItems(
    listId: string,
    query: CrunchyListItemsQuery = {},
  ): Promise<CrunchyListItemsResponse> {
    const cleanListId = this.validateId(listId, "listId");
    const accountId = this.requireAccountIdOrProfileId();
    const payload = await this.requestJson(
      `/content/v2/${encodeURIComponent(accountId)}/custom-lists/${encodeURIComponent(cleanListId)}`,
      {
        query: this.withLocale(query),
        useSessionCookie: this.sendCookieWithContentRequests,
      },
    );

    return this.parseListResponse(payload, "custom list items");
  }

  public async getEpisodeInfo(episodeId: string, locale?: string): Promise<EpisodeInfo> {
    const cleanEpisodeId = this.validateId(episodeId, "episodeId");
    const query = locale === undefined ? this.withLocale({}) : this.withLocale({ locale });
    const payload = await this.requestJson(`/content/v2/cms/episodes/${encodeURIComponent(cleanEpisodeId)}`, {
      query,
      useSessionCookie: this.sendCookieWithContentRequests,
    });

    const record = ensureRecord(payload, "episode response");
    const data = record.data;

    if (isRecord(data)) {
      return data as EpisodeInfo;
    }

    if (Array.isArray(data) && data.length > 0 && isRecord(data[0])) {
      return data[0] as EpisodeInfo;
    }

    throw new CrunchyrollApiError("Invalid episode response shape.");
  }

  public async getSeasonEpisodes(
    seasonId: string,
    query: SeasonEpisodesQuery = {},
  ): Promise<SeasonEpisodesResponse> {
    const cleanSeasonId = this.validateId(seasonId, "seasonId");

    const payload = await this.requestJson(`/content/v2/cms/seasons/${encodeURIComponent(cleanSeasonId)}/episodes`, {
      query: this.withLocale(query),
      useSessionCookie: this.sendCookieWithContentRequests,
    });

    return this.parseListResponse(payload, "season episodes");
  }

  private async requestJson(path: string, options: RequestOptions): Promise<unknown> {
    const url = this.buildUrl(path, options.query);
    const headers = new Headers(options.headers);
    headers.set("accept", "application/json");

    if (!headers.has("user-agent") && this.userAgent) {
      headers.set("user-agent", this.userAgent);
    }

    const useBearerAuth = options.useBearerAuth ?? true;
    if (useBearerAuth) {
      const session = this.requireSession();
      this.ensureTokenNotExpired(session);
      headers.set("authorization", `Bearer ${session.accessToken}`);
    }

    const useSessionCookie = options.useSessionCookie ?? false;
    if (useSessionCookie) {
      const session = this.requireSession();
      if (!session.cookie) {
        throw new CrunchyrollAuthError(
          "Session cookie is missing. Authenticate with authenticateWithRtCookie() or setSession().",
        );
      }

      if (!this.allowCookieOnCustomBaseUrl && this.baseUrl.hostname !== DEFAULT_CRUNCHYROLL_HOST) {
        throw new CrunchyrollValidationError(
          "Refusing to send cookie to non-default host. Set allowCookieOnCustomBaseUrl=true only in trusted test environments.",
        );
      }

      headers.set("cookie", this.sanitizeCookie(session.cookie));
    }

    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const requestInit: RequestInit = {
        method: options.method ?? "GET",
        headers,
        signal: controller.signal,
      };

      if (options.body !== undefined) {
        requestInit.body = options.body;
      }

      const response = await this.fetchImpl(url.toString(), requestInit);

      const contentType = response.headers.get("content-type") ?? "";
      const requestId = response.headers.get("x-request-id") ?? undefined;
      const bodyText = await response.text();

      let payload: unknown;
      if (bodyText.length === 0) {
        payload = {};
      } else if (contentType.includes("application/json") || this.looksLikeJson(bodyText)) {
        payload = this.safeJsonParse(bodyText);
      } else {
        payload = { message: bodyText };
      }

      if (!response.ok) {
        const message = this.extractErrorMessage(payload) ?? `${response.status} ${response.statusText}`;
        throw new CrunchyrollApiError(`Crunchyroll API request failed: ${message}`, response.status, requestId);
      }

      return payload;
    } catch (error: unknown) {
      if (error instanceof CrunchyrollApiError) {
        throw error;
      }

      if (error instanceof DOMException && error.name === "AbortError") {
        throw new CrunchyrollApiError(`Crunchyroll API request timed out after ${timeoutMs}ms.`);
      }

      if (error instanceof Error) {
        throw new CrunchyrollApiError(`Crunchyroll API request failed: ${error.message}`);
      }

      throw new CrunchyrollApiError("Crunchyroll API request failed due to an unknown error.");
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  private parseAnonymousToken(payload: unknown): AnonymousTokenResponse {
    const record = ensureRecord(payload, "anonymous token response");
    const access_token = requireString(record, "access_token", "anonymous token response");
    const token_type = requireString(record, "token_type", "anonymous token response");
    const expires_in = getNumber(record, "expires_in");
    if (expires_in === undefined) {
      throw new CrunchyrollApiError("Invalid anonymous token response: expires_in must be a number.");
    }

    const token: AnonymousTokenResponse = {
      access_token,
      token_type,
      expires_in,
    };

    const scope = getString(record, "scope");
    const country = getString(record, "country");
    const accountId = getString(record, "account_id");
    const profileId = getString(record, "profile_id");

    if (scope !== undefined) {
      token.scope = scope;
    }

    if (country !== undefined) {
      token.country = country;
    }

    if (accountId !== undefined) {
      token.account_id = accountId;
    }

    if (profileId !== undefined) {
      token.profile_id = profileId;
    }

    return token;
  }

  private parseCookieToken(payload: unknown): CookieTokenResponse {
    const record = ensureRecord(payload, "cookie token response");
    const access_token = requireString(record, "access_token", "cookie token response");
    const token_type = requireString(record, "token_type", "cookie token response");
    const expires_in = getNumber(record, "expires_in");
    if (expires_in === undefined) {
      throw new CrunchyrollApiError("Invalid cookie token response: expires_in must be a number.");
    }

    const token: CookieTokenResponse = {
      access_token,
      token_type,
      expires_in,
    };

    const refreshToken = getString(record, "refresh_token");
    const scope = getString(record, "scope");
    const accountId = getString(record, "account_id");
    const profileId = getString(record, "profile_id");

    if (refreshToken !== undefined) {
      token.refresh_token = refreshToken;
    }

    if (scope !== undefined) {
      token.scope = scope;
    }

    if (accountId !== undefined) {
      token.account_id = accountId;
    }

    if (profileId !== undefined) {
      token.profile_id = profileId;
    }

    return token;
  }

  private parseListResponse<T>(payload: unknown, context: string): ApiListResponse<T> {
    const record = ensureRecord(payload, context);
    const data = record.data;
    if (!Array.isArray(data)) {
      throw new CrunchyrollApiError(`Invalid ${context} response: expected data array.`);
    }

    return {
      ...record,
      data: data as T[],
    };
  }

  private requireSession(): AuthSession {
    if (!this.session) {
      throw new CrunchyrollAuthError(
        "Not authenticated. Call authenticateWithRtCookie() or setSession() before calling this endpoint.",
      );
    }

    return this.session;
  }

  private requireProfileId(): string {
    const session = this.requireSession();
    if (session.profileId && session.profileId.length > 0) {
      return session.profileId;
    }

    throw new CrunchyrollAuthError("profile_id is missing in session. Re-authenticate and try again.");
  }

  private requireAccountIdOrProfileId(): string {
    const session = this.requireSession();
    if (session.accountId && session.accountId.length > 0) {
      return session.accountId;
    }

    if (session.profileId && session.profileId.length > 0) {
      return session.profileId;
    }

    throw new CrunchyrollAuthError("Neither account_id nor profile_id is available in session.");
  }

  private ensureTokenNotExpired(session: AuthSession): void {
    if (!session.expiresAt) {
      return;
    }

    const skewMs = 30_000;
    if (Date.now() + skewMs >= session.expiresAt) {
      throw new CrunchyrollAuthError("Access token is expired or about to expire. Re-authenticate with cookie.");
    }
  }

  private validateBasicAuth(value: string, fieldName: string): string {
    const trimmed = value.trim();
    if (!trimmed.startsWith("Basic ")) {
      throw new CrunchyrollValidationError(`${fieldName} must start with \"Basic \".`);
    }

    if (/\r|\n/.test(trimmed)) {
      throw new CrunchyrollValidationError(`${fieldName} contains invalid line breaks.`);
    }

    return trimmed;
  }

  private validateId(value: string, fieldName: string): string {
    const trimmed = value.trim();
    if (!trimmed) {
      throw new CrunchyrollValidationError(`${fieldName} is required.`);
    }

    if (/\r|\n/.test(trimmed)) {
      throw new CrunchyrollValidationError(`${fieldName} contains invalid line breaks.`);
    }

    return trimmed;
  }

  private sanitizeCookie(cookie: string): string {
    const trimmed = cookie.trim();
    if (!trimmed) {
      throw new CrunchyrollValidationError("Cookie is required.");
    }

    if (/\r|\n/.test(trimmed)) {
      throw new CrunchyrollValidationError("Cookie contains invalid line breaks.");
    }

    if (trimmed.length > 4096) {
      throw new CrunchyrollValidationError("Cookie is suspiciously large and was rejected.");
    }

    return trimmed;
  }

  private withLocale<T extends { locale?: string }>(
    query: T,
  ): Record<string, QueryValue | undefined> {
    const withDefaultLocale: Record<string, QueryValue | undefined> = {
      ...query,
    };

    if (withDefaultLocale.locale === undefined) {
      withDefaultLocale.locale = this.locale;
    }

    return withDefaultLocale;
  }

  private buildUrl(path: string, query?: Record<string, QueryValue | undefined>): URL {
    const url = new URL(path, this.baseUrl);

    if (!query) {
      return url;
    }

    for (const [key, value] of Object.entries(query)) {
      if (value === undefined) {
        continue;
      }

      url.searchParams.set(key, String(value));
    }

    return url;
  }

  private parseBaseUrl(baseUrl: string): URL {
    let url: URL;
    try {
      url = new URL(baseUrl);
    } catch {
      throw new CrunchyrollValidationError(`Invalid baseUrl: ${baseUrl}`);
    }

    if (url.protocol !== "https:") {
      throw new CrunchyrollValidationError("baseUrl must use HTTPS.");
    }

    return url;
  }

  private getGlobalFetch(): typeof fetch {
    if (typeof fetch !== "function") {
      throw new CrunchyrollValidationError(
        "Global fetch is unavailable in this runtime. Provide fetchImpl in client options.",
      );
    }

    return fetch;
  }

  private ensureServerRuntime(): void {
    if (typeof window !== "undefined") {
      throw new CrunchyrollValidationError(
        "Cookie authentication must run on the server. Do not expose Crunchyroll cookie auth in browser code.",
      );
    }
  }

  private makeDeviceId(): string {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }

    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  private looksLikeJson(raw: string): boolean {
    const trimmed = raw.trim();
    return trimmed.startsWith("{") || trimmed.startsWith("[");
  }

  private safeJsonParse(raw: string): unknown {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      throw new CrunchyrollApiError("Expected JSON response but received malformed JSON.");
    }
  }

  private extractErrorMessage(payload: unknown): string | undefined {
    if (!isRecord(payload)) {
      return undefined;
    }

    const directMessage = getString(payload, "message") ?? getString(payload, "error_description");
    if (directMessage) {
      return directMessage;
    }

    const errorValue = getString(payload, "error");
    return errorValue;
  }

  private looksInProgress(entry: WatchHistoryEntry): boolean {
    const candidates: Record<string, unknown>[] = [entry];
    if (isRecord(entry.panel)) {
      candidates.push(entry.panel);
    }

    for (const candidate of candidates) {
      const fullyWatched = getBoolean(candidate, "fully_watched") ?? getBoolean(candidate, "is_completed");
      if (fullyWatched === true) {
        return false;
      }
      if (fullyWatched === false) {
        return true;
      }

      const progress = getNumber(candidate, "progress");
      if (progress !== undefined && progress > 0 && progress < 1) {
        return true;
      }

      const playhead = getNumber(candidate, "playhead") ?? getNumber(candidate, "playhead_ms");
      const duration = getNumber(candidate, "duration") ?? getNumber(candidate, "duration_ms");
      if (playhead !== undefined && duration !== undefined && playhead > 0 && playhead < duration) {
        return true;
      }
    }

    return false;
  }
}