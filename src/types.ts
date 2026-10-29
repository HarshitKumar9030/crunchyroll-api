export type FetchLike = typeof fetch;

export interface AnonymousTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
  country?: string;
  account_id?: string;
  profile_id?: string;
}

export interface CookieTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  account_id?: string;
  profile_id?: string;
}

export interface AuthSession {
  accessToken: string;
  tokenType: string;
  expiresAt?: number;
  refreshToken?: string;
  profileId?: string;
  accountId?: string;
  cookie?: string;
}

export interface CrunchyrollClientOptions {
  baseUrl?: string;
  locale?: string;
  timeoutMs?: number;
  userAgent?: string;
  fetchImpl?: FetchLike;
  anonymousBasicAuth?: string;
  etpRtCookieBasicAuth?: string;
  defaultDeviceType?: string;
  sendCookieWithContentRequests?: boolean;
  allowCookieOnCustomBaseUrl?: boolean;
}

export interface CookieAuthInput {
  cookie: string;
  deviceType?: string;
  deviceId?: string;
  basicAuth?: string;
}

export interface ApiListResponse<T> {
  data: T[];
  total?: number;
  [key: string]: unknown;
}

export interface ApiObjectResponse<T> {
  data: T;
  [key: string]: unknown;
}

export interface CrunchyPanel {
  id?: string;
  type?: string;
  title?: string;
  description?: string;
  [key: string]: unknown;
}

export interface CrunchyItem {
  id?: string;
  type?: string;
  panel?: CrunchyPanel;
  [key: string]: unknown;
}

export type WatchlistEntry = CrunchyItem;
export type WatchHistoryEntry = CrunchyItem;
export type CrunchyList = CrunchyItem;
export type CrunchyListItem = CrunchyItem;

export interface EpisodeInfo {
  id?: string;
  type?: string;
  title?: string;
  slug_title?: string;
  episode_number?: number;
  season_number?: number;
  [key: string]: unknown;
}

export type WatchlistResponse = ApiListResponse<WatchlistEntry>;
export type WatchHistoryResponse = ApiListResponse<WatchHistoryEntry>;
export type CrunchyListsResponse = ApiListResponse<CrunchyList>;
export type CrunchyListItemsResponse = ApiListResponse<CrunchyListItem>;
export type SeasonEpisodesResponse = ApiListResponse<EpisodeInfo>;

export interface CurrentlyWatchingResponse extends ApiListResponse<WatchHistoryEntry> {
  filtered_from_total: number;
}

export interface WatchlistQuery {
  n?: number;
  start?: number;
  order?: "desc" | "asc";
  type?: "series" | "movie_listing";
  sort_by?: "date_updated" | "date_watched" | "date_added" | "alphabetical";
  is_favorite?: boolean;
  is_dubbed?: boolean;
  is_subbed?: boolean;
  locale?: string;
}

export interface WatchHistoryQuery {
  page_size?: number;
  page?: number;
  locale?: string;
}

export interface CrunchyListItemsQuery {
  page_size?: number;
  page?: number;
  sort_by?: "manual" | "date_added";
  order?: "asc" | "desc";
  locale?: string;
}

export interface SeasonEpisodesQuery {
  n?: number;
  start?: number;
  locale?: string;
}
/** Overrides for a single HTTP request. */
export interface CrunchyrollRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** Limits lazy pagination; breaking a for-await loop stops further requests. */
export interface PaginationOptions extends CrunchyrollRequestOptions {
  maxPages?: number;
}

export interface SeriesInfo extends CrunchyPanel {
  slug_title?: string;
  season_count?: number;
}

export interface SeasonInfo extends CrunchyPanel {
  series_id?: string;
  season_number?: number;
  number_of_episodes?: number;
}

export interface SeriesSeasonsQuery {
  locale?: string;
}

export type SeriesSeasonsResponse = ApiListResponse<SeasonInfo>;
