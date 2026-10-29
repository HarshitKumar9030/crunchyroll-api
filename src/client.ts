import { CrunchyrollAbortError, CrunchyrollApiError, CrunchyrollAuthError, CrunchyrollValidationError } from "./errors.js";
import { ensureRecord, getBoolean, getNumber, getString, isRecord, requireString } from "./guards.js";
import type {
  CrunchyrollRequestOptions,
  PaginationOptions,
  SeriesInfo,
  SeasonInfo,
  SeriesSeasonsQuery,
  SeriesSeasonsResponse,
  CrunchyListItem,
  WatchlistEntry,
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

type RequestOptions = CrunchyrollRequestOptions & {
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
    this.locale = this.validateId(options.locale ?? DEFAULT_LOCALE, "locale");
    this.timeoutMs = this.validateTimeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    this.userAgent = this.validateHeader(options.userAgent ?? DEFAULT_USER_AGENT, "userAgent");
    this.fetchImpl = options.fetchImpl ?? this.getGlobalFetch();
    this.anonymousBasicAuth = this.validateBasicAuth(
      options.anonymousBasicAuth ?? DEFAULT_ANONYMOUS_BASIC_AUTH,
      "anonymousBasicAuth",
    );
    this.etpRtCookieBasicAuth = this.validateBasicAuth(
      options.etpRtCookieBasicAuth ?? DEFAULT_ETP_RT_COOKIE_BASIC_AUTH,
      "etpRtCookieBasicAuth",
    );
    this.defaultDeviceType = this.validateId(options.defaultDeviceType ?? DEFAULT_DEVICE_TYPE, "defaultDeviceType");
    this.sendCookieWithContentRequests = options.sendCookieWithContentRequests ?? true;
    this.allowCookieOnCustomBaseUrl = options.allowCookieOnCustomBaseUrl ?? false;
  }

  public setSession(session: AuthSession): void {
    const nextSession: AuthSession = {
      accessToken: this.validateBearerToken(session.accessToken),
      tokenType: this.validateTokenType(session.tokenType),
    };

    if (session.expiresAt !== undefined) {
      if (!Number.isFinite(session.expiresAt) || session.expiresAt <= 0) {
        throw new CrunchyrollValidationError("expiresAt must be a positive, finite timestamp in milliseconds.");
      }
      nextSession.expiresAt = session.expiresAt;
    }

    if (session.refreshToken !== undefined) {
      nextSession.refreshToken = this.validateId(session.refreshToken, "refreshToken");
    }

    if (session.profileId !== undefined) {
      nextSession.profileId = this.validateId(session.profileId, "profileId");
    }

    if (session.accountId !== undefined) {
      nextSession.accountId = this.validateId(session.accountId, "accountId");
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
    return this.session !== null && (this.session.expiresAt === undefined || Date.now() + 30_000 < this.session.expiresAt);
  }

  public async getAnonymousToken(options: CrunchyrollRequestOptions = {}): Promise<AnonymousTokenResponse> {
    const body = new URLSearchParams({ grant_type: "client_id" }).toString();

    const payload = await this.requestJson("/auth/v1/token", {
      ...this.requestControls(options),
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

  public async authenticateWithRtCookie(input: CookieAuthInput, options: CrunchyrollRequestOptions = {}): Promise<AuthSession> {
    this.ensureServerRuntime();

    const cookie = this.sanitizeCookie(input.cookie);
    if (!/(?:^|;\s*)etp_rt=[^;\s]+(?:;|$)/.test(cookie)) {
      throw new CrunchyrollValidationError(
        "Cookie must include etp_rt. Pass the complete Crunchyroll cookie string from a logged-in user session.",
      );
    }

    const authHeader = this.validateBasicAuth(input.basicAuth ?? this.etpRtCookieBasicAuth, "basicAuth");
    const deviceId = this.validateId(input.deviceId ?? this.makeDeviceId(), "deviceId");
    const deviceType = this.validateId(input.deviceType ?? this.defaultDeviceType, "deviceType");

    const body = new URLSearchParams({
      device_type: deviceType,
      device_id: deviceId,
      grant_type: "etp_rt_cookie",
    }).toString();

    const payload = await this.requestJson("/auth/v1/token", {
      ...this.requestControls(options),
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

    this.setSession(session);
    return this.getSession() as AuthSession;
  }

  public async getWatchlist(query: WatchlistQuery = {}, options: CrunchyrollRequestOptions = {}): Promise<WatchlistResponse> {
    const profileId = this.requireProfileId();
    const payload = await this.requestJson(`/content/v2/discover/${encodeURIComponent(profileId)}/watchlist`, {
      ...this.requestControls(options),
      query: this.withLocale(query),
      useSessionCookie: this.sendCookieWithContentRequests,
    });

    return this.parseListResponse(payload, "watchlist");
  }

  public async getWatchHistory(query: WatchHistoryQuery = {}, options: CrunchyrollRequestOptions = {}): Promise<WatchHistoryResponse> {
    const accountId = this.requireAccountIdOrProfileId();
    const payload = await this.requestJson(`/content/v2/${encodeURIComponent(accountId)}/watch-history`, {
      ...this.requestControls(options),
      query: this.withLocale(query),
      useSessionCookie: this.sendCookieWithContentRequests,
    });

    return this.parseListResponse(payload, "watch history");
  }

  public async getHistory(query: WatchHistoryQuery = {}, options: CrunchyrollRequestOptions = {}): Promise<WatchHistoryResponse> {
    return this.getWatchHistory(query, options);
  }

  public async getWatchedAnime(query: WatchHistoryQuery = {}, options: CrunchyrollRequestOptions = {}): Promise<WatchHistoryResponse> {
    return this.getWatchHistory(query, options);
  }

  public async getCurrentlyWatching(query: WatchHistoryQuery = {}, options: CrunchyrollRequestOptions = {}): Promise<CurrentlyWatchingResponse> {
    const history = await this.getWatchHistory(query, options);
    const filteredData = history.data.filter((entry) => this.looksInProgress(entry));

    return {
      ...history,
      data: filteredData,
      filtered_from_total: history.data.length,
    };
  }

  public async getCrunchylists(options: CrunchyrollRequestOptions = {}): Promise<CrunchyListsResponse> {
    const accountId = this.requireAccountIdOrProfileId();
    const payload = await this.requestJson(`/content/v2/${encodeURIComponent(accountId)}/custom-lists`, {
      ...this.requestControls(options),
      query: this.withLocale({}),
      useSessionCookie: this.sendCookieWithContentRequests,
    });

    return this.parseListResponse(payload, "custom lists");
  }

  public async getCrunchylistItems(
    listId: string,
    query: CrunchyListItemsQuery = {},
    options: CrunchyrollRequestOptions = {},
  ): Promise<CrunchyListItemsResponse> {
    const cleanListId = this.validateId(listId, "listId");
    const accountId = this.requireAccountIdOrProfileId();
    const payload = await this.requestJson(
      `/content/v2/${encodeURIComponent(accountId)}/custom-lists/${encodeURIComponent(cleanListId)}`,
      {
        ...this.requestControls(options),
        query: this.withLocale(query),
        useSessionCookie: this.sendCookieWithContentRequests,
      },
    );

    return this.parseListResponse(payload, "custom list items");
  }

  public async getEpisodeInfo(episodeId: string, locale?: string, options: CrunchyrollRequestOptions = {}): Promise<EpisodeInfo> {
    const cleanEpisodeId = this.validateId(episodeId, "episodeId");
    const query = locale === undefined ? this.withLocale({}) : this.withLocale({ locale });
    const payload = await this.requestJson(`/content/v2/cms/episodes/${encodeURIComponent(cleanEpisodeId)}`, {
      ...this.requestControls(options),
      query,
      useSessionCookie: this.sendCookieWithContentRequests,
    });

    return this.parseObjectResponse<EpisodeInfo>(payload, "episode");
  }

  public async getSeasonEpisodes(
    seasonId: string,
    query: SeasonEpisodesQuery = {},
    options: CrunchyrollRequestOptions = {},
  ): Promise<SeasonEpisodesResponse> {
    const cleanSeasonId = this.validateId(seasonId, "seasonId");

    const payload = await this.requestJson(`/content/v2/cms/seasons/${encodeURIComponent(cleanSeasonId)}/episodes`, {
      ...this.requestControls(options),
      query: this.withLocale(query),
      useSessionCookie: this.sendCookieWithContentRequests,
    });

    return this.parseListResponse(payload, "season episodes");
  }

  public async getSeriesInfo(seriesId: string, locale?: string, options: CrunchyrollRequestOptions = {}): Promise<SeriesInfo> {
    const id = this.validateId(seriesId, "seriesId");
    const payload = await this.requestJson(`/content/v2/cms/series/${encodeURIComponent(id)}`, {
      ...this.requestControls(options),
      query: this.withLocale(locale === undefined ? {} : { locale }),
      useSessionCookie: this.sendCookieWithContentRequests,
    });
    return this.parseObjectResponse<SeriesInfo>(payload, "series");
  }

  public async getSeasonInfo(seasonId: string, locale?: string, options: CrunchyrollRequestOptions = {}): Promise<SeasonInfo> {
    const id = this.validateId(seasonId, "seasonId");
    const payload = await this.requestJson(`/content/v2/cms/seasons/${encodeURIComponent(id)}`, {
      ...this.requestControls(options),
      query: this.withLocale(locale === undefined ? {} : { locale }),
      useSessionCookie: this.sendCookieWithContentRequests,
    });
    return this.parseObjectResponse<SeasonInfo>(payload, "season");
  }

  public async getSeriesSeasons(seriesId: string, query: SeriesSeasonsQuery = {}, options: CrunchyrollRequestOptions = {}): Promise<SeriesSeasonsResponse> {
    const id = this.validateId(seriesId, "seriesId");
    const payload = await this.requestJson(`/content/v2/cms/series/${encodeURIComponent(id)}/seasons`, {
      ...this.requestControls(options),
      query: this.withLocale(query),
      useSessionCookie: this.sendCookieWithContentRequests,
    });
    return this.parseListResponse<SeasonInfo>(payload, "series seasons");
  }

  public iterateWatchlist(query: WatchlistQuery = {}, options: PaginationOptions = {}): AsyncGenerator<WatchlistEntry> {
    const initial = { ...query };
    return this.paginate((position) => this.getWatchlist({ ...initial, n: initial.n ?? 100, start: position }, options), initial.start ?? 0, false, options);
  }

  public iterateWatchHistory(query: WatchHistoryQuery = {}, options: PaginationOptions = {}): AsyncGenerator<WatchHistoryEntry> {
    const initial = { ...query };
    return this.paginate((position) => this.getWatchHistory({ ...initial, page_size: initial.page_size ?? 100, page: position }, options), initial.page ?? 1, true, options, initial.page_size ?? 100);
  }

  public iterateCrunchylistItems(listId: string, query: CrunchyListItemsQuery = {}, options: PaginationOptions = {}): AsyncGenerator<CrunchyListItem> {
    const initial = { ...query };
    return this.paginate((position) => this.getCrunchylistItems(listId, { ...initial, page_size: initial.page_size ?? 100, page: position }, options), initial.page ?? 1, true, options, initial.page_size ?? 100);
  }

  public iterateSeasonEpisodes(seasonId: string, query: SeasonEpisodesQuery = {}, options: PaginationOptions = {}): AsyncGenerator<EpisodeInfo> {
    const initial = { ...query };
    return this.paginate((position) => this.getSeasonEpisodes(seasonId, { ...initial, n: initial.n ?? 100, start: position }, options), initial.start ?? 0, false, options);
  }

  private async *paginate<T>(
    fetchPage: (position: number) => Promise<ApiListResponse<T>>,
    position: number,
    numbered: boolean,
    options: PaginationOptions,
    pageSize = 100,
  ): AsyncGenerator<T> {
    const maxPages = options.maxPages ?? 1000;
    if (!Number.isSafeInteger(maxPages) || maxPages < 1) {
      throw new CrunchyrollValidationError("maxPages must be a positive integer.");
    }
    let consumed = numbered ? (position - 1) * pageSize : position;
    for (let pages = 0; pages < maxPages; pages++) {
      this.throwIfAborted(options.signal);
      const response = await fetchPage(position);
      if (response.data.length === 0) return;
      for (const item of response.data) {
        this.throwIfAborted(options.signal);
        yield item;
      }
      consumed += response.data.length;
      if (response.total !== undefined && consumed >= response.total) return;
      position += numbered ? 1 : response.data.length;
      if (!Number.isSafeInteger(position)) {
        throw new CrunchyrollValidationError("Pagination exceeded the safe integer range.");
      }
    }
  }

  private parseObjectResponse<T>(payload: unknown, context: string): T {
    const record = ensureRecord(payload, `${context} response`);
    if (isRecord(record.data)) return record.data as T;
    if (Array.isArray(record.data) && record.data.length > 0 && isRecord(record.data[0])) return record.data[0] as T;
    throw new CrunchyrollApiError(`Invalid ${context} response shape.`);
  }

  private requestControls(options: CrunchyrollRequestOptions): CrunchyrollRequestOptions {
    const controls: CrunchyrollRequestOptions = {};
    if (options.signal !== undefined) controls.signal = options.signal;
    if (options.timeoutMs !== undefined) controls.timeoutMs = options.timeoutMs;
    return controls;
  }

  private validateTimeout(value: number): number {
    if (!Number.isSafeInteger(value) || value <= 0 || value > 2_147_483_647) {
      throw new CrunchyrollValidationError("timeoutMs must be a positive integer no greater than 2147483647.");
    }
    return value;
  }

  private throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) throw new CrunchyrollAbortError();
  }

  private async requestJson(path: string, options: RequestOptions): Promise<unknown> {
    this.throwIfAborted(options.signal);
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

      headers.set("cookie", this.sanitizeCookie(session.cookie));
    }

    if (headers.has("cookie") && !this.allowCookieOnCustomBaseUrl && this.baseUrl.origin !== DEFAULT_BASE_URL) {
      throw new CrunchyrollValidationError(
        "Refusing to send cookie to non-default origin. Set allowCookieOnCustomBaseUrl=true only for trusted servers.",
      );
    }

    const timeoutMs = this.validateTimeout(options.timeoutMs ?? this.timeoutMs);
    const controller = new AbortController();
    let timedOut = false;
    const cancel = () => controller.abort();
    options.signal?.addEventListener("abort", cancel, { once: true });
    const timeoutHandle = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);

    try {
      const requestInit: RequestInit = {
        method: options.method ?? "GET",
        headers,
        signal: controller.signal,
        redirect: "error",
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
        try {
          payload = this.safeJsonParse(bodyText);
        } catch {
          throw new CrunchyrollApiError("Expected JSON response but received malformed JSON.", response.status, requestId);
        }
      } else {
        payload = { message: bodyText };
      }

      if (!response.ok) {
        const message = this.extractErrorMessage(payload) ?? `${response.status} ${response.statusText}`;
        const ErrorClass = response.status === 401 || response.status === 403 ? CrunchyrollAuthError : CrunchyrollApiError;
        throw new ErrorClass(`Crunchyroll API request failed: ${message}`, response.status, requestId);
      }

      return payload;
    } catch (error: unknown) {
      if (error instanceof CrunchyrollApiError) {
        throw error;
      }

      if (controller.signal.aborted && !timedOut) {
        throw new CrunchyrollAbortError();
      }
      if (timedOut) {
        throw new CrunchyrollApiError(`Crunchyroll API request timed out after ${timeoutMs}ms.`);
      }

      if (error instanceof Error) {
        throw new CrunchyrollApiError(`Crunchyroll API request failed: ${error.message}`);
      }

      throw new CrunchyrollApiError("Crunchyroll API request failed due to an unknown error.");
    } finally {
      clearTimeout(timeoutHandle);
      options.signal?.removeEventListener("abort", cancel);
    }
  }

  private parseAnonymousToken(payload: unknown): AnonymousTokenResponse {
    const record = ensureRecord(payload, "anonymous token response");
    const access_token = requireString(record, "access_token", "anonymous token response");
    const token_type = requireString(record, "token_type", "anonymous token response");
    const expires_in = getNumber(record, "expires_in");
    if (expires_in === undefined || expires_in <= 0 || !Number.isFinite(Date.now() + expires_in * 1000)) {
      throw new CrunchyrollApiError("Invalid anonymous token response: expires_in must be a positive finite lifetime.");
    }

    try {
      this.validateBearerToken(access_token);
      this.validateTokenType(token_type);
    } catch {
      throw new CrunchyrollApiError("Invalid token response: expected a valid bearer token and Bearer token_type.");
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
    if (expires_in === undefined || expires_in <= 0 || !Number.isFinite(Date.now() + expires_in * 1000)) {
      throw new CrunchyrollApiError("Invalid cookie token response: expires_in must be a positive finite lifetime.");
    }

    try {
      this.validateBearerToken(access_token);
      this.validateTokenType(token_type);
    } catch {
      throw new CrunchyrollApiError("Invalid token response: expected a valid bearer token and Bearer token_type.");
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
    if (!Array.isArray(data) || !data.every(isRecord)) {
      throw new CrunchyrollApiError(`Invalid ${context} response: expected data array of objects.`);
    }

    if (record.total !== undefined && (typeof record.total !== "number" || !Number.isSafeInteger(record.total) || record.total < 0)) {
      throw new CrunchyrollApiError(`Invalid ${context} response: total must be a non-negative integer.`);
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

  private validateHeader(value: string, fieldName: string): string {
    if (typeof value !== "string" || /[\x00-\x1f\x7f-\uffff]/.test(value)) {
      throw new CrunchyrollValidationError(`${fieldName} must be a string without control or non-ASCII characters.`);
    }
    return value;
  }

  private validateBearerToken(value: string): string {
    if (typeof value !== "string" || !/^[A-Za-z0-9._~+/-]+=*$/.test(value)) {
      throw new CrunchyrollValidationError("accessToken must be a non-empty bearer token.");
    }
    return value;
  }

  private validateTokenType(value: string): string {
    if (typeof value !== "string" || value.toLowerCase() !== "bearer") {
      throw new CrunchyrollValidationError("tokenType must be Bearer.");
    }
    return value;
  }

  private validateBasicAuth(value: string, fieldName: string): string {
    const trimmed = this.validateHeader(value, fieldName).trim();
    if (!/^Basic [A-Za-z0-9+/]+={0,2}$/i.test(trimmed)) {
      throw new CrunchyrollValidationError(`${fieldName} must contain a Basic authentication scheme and base64 credentials.`);
    }

    return trimmed;
  }

  private validateId(value: string, fieldName: string): string {
    const trimmed = this.validateHeader(value, fieldName).trim();
    if (!trimmed || trimmed === "." || trimmed === "..") {
      throw new CrunchyrollValidationError(`${fieldName} must be a non-empty identifier other than a dot segment.`);
    }

    return trimmed;
  }

  private sanitizeCookie(cookie: string): string {
    const trimmed = this.validateHeader(cookie, "Cookie").trim();
    if (!trimmed) {
      throw new CrunchyrollValidationError("Cookie is required.");
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

      if (["n", "start", "page_size", "page"].includes(key) && typeof value !== "number") {
        throw new CrunchyrollValidationError(`${key} must be a number.`);
      }
      if (typeof value === "number") {
        const minimum = key === "n" || key === "page_size" || key === "page" ? 1 : 0;
        if (!Number.isSafeInteger(value) || value < minimum) {
          throw new CrunchyrollValidationError(`${key} must be an integer greater than or equal to ${minimum}.`);
        }
      } else if (typeof value === "string") {
        this.validateId(value, key);
      } else if (typeof value !== "boolean") {
        throw new CrunchyrollValidationError(`${key} must be a string, number, or boolean.`);
      }
      const allowed: Record<string, readonly string[]> = {
        order: ["asc", "desc"],
        type: ["series", "movie_listing"],
        sort_by: ["date_updated", "date_watched", "date_added", "alphabetical", "manual"],
      };
      if (allowed[key] && !allowed[key].includes(String(value))) {
        throw new CrunchyrollValidationError(`Invalid ${key}.`);
      }
      if (["is_favorite", "is_dubbed", "is_subbed"].includes(key) && typeof value !== "boolean") {
        throw new CrunchyrollValidationError(`${key} must be a boolean.`);
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
      throw new CrunchyrollValidationError("Invalid baseUrl.");
    }

    if (url.protocol !== "https:") {
      throw new CrunchyrollValidationError("baseUrl must use HTTPS.");
    }

    if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
      throw new CrunchyrollValidationError("baseUrl must be an HTTPS origin without credentials, a path, query, or fragment.");
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

    // Explicit completion on either level takes precedence over progress hints.
    if (candidates.some((candidate) => getBoolean(candidate, "fully_watched") === true || getBoolean(candidate, "is_completed") === true)) {
      return false;
    }
    for (const candidate of candidates) {
      const progress = getNumber(candidate, "progress");
      if (progress !== undefined && progress >= 1) {
        return false;
      }
      for (const [positionKey, durationKey] of [["playhead", "duration"], ["playhead_ms", "duration_ms"]] as const) {
        const position = getNumber(candidate, positionKey);
        const duration = getNumber(candidate, durationKey);
        if (position !== undefined && duration !== undefined && duration > 0 && position >= duration) {
          return false;
        }
      }
    }
    for (const candidate of candidates) {
      const progress = getNumber(candidate, "progress");
      if (progress !== undefined && progress > 0 && progress < 1) return true;
      for (const [positionKey, durationKey] of [["playhead", "duration"], ["playhead_ms", "duration_ms"]] as const) {
        const position = getNumber(candidate, positionKey);
        const duration = getNumber(candidate, durationKey);
        if (position !== undefined && duration !== undefined && position > 0 && position < duration) return true;
      }
      if (getBoolean(candidate, "fully_watched") === false || getBoolean(candidate, "is_completed") === false) return true;
    }

    return false;
  }
}