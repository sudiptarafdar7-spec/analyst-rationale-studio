# 04 — Backend API Specification (FastAPI)

Base path `/api`. JSON everywhere. Auth via `Authorization: Bearer <access>`. Refresh token in
httpOnly cookie. All list endpoints support `?page=&size=`. Errors use a consistent shape:
`{ "detail": "message", "code": "OPTIONAL_CODE" }`.

Routers live in `backend/api/`. Each section below = one router file.

## auth.py
| Method | Path | Role | Body / Notes |
|---|---|---|---|
| POST | `/auth/login` | public | `{email, password}` → `{access_token, user}`; sets refresh cookie |
| POST | `/auth/refresh` | cookie | → new access token |
| POST | `/auth/logout` | auth | revoke refresh |
| GET  | `/auth/me` | auth | current user |

## users.py (profile + admin user mgmt)
| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/users/me` | auth | profile |
| PATCH | `/users/me` | auth | first/last/mobile |
| POST | `/users/me/avatar` | auth | multipart image |
| POST | `/users/me/password` | auth | `{current, new}` |
| GET | `/users` | admin | list users |
| POST | `/users` | admin | create user (email, names, role, temp password) |
| PATCH | `/users/{id}` | admin | update role/active |

## platforms.py (admin write, all read)
| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/platforms` | auth | list active |
| POST | `/platforms` | admin | multipart: type, channel_name, url, logo |
| PATCH | `/platforms/{id}` | admin | edit |
| DELETE | `/platforms/{id}` | admin | soft delete (block if in use) |

## api_keys.py (admin only)
| Method | Path | Notes |
|---|---|---|
| GET | `/admin/api-keys` | list providers + masked + last_test |
| PUT | `/admin/api-keys/{provider}` | set/update (encrypts) |
| DELETE | `/admin/api-keys/{provider}` | remove |
| POST | `/admin/api-keys/{provider}/test` | live connectivity test |
| POST | `/admin/api-keys/{provider}/reveal` | re-auth + return plaintext once |

## ai_models.py (admin only)
| Method | Path | Notes |
|---|---|---|
| GET | `/admin/ai-models` | mapping for 4 tasks + global/advanced |
| PUT | `/admin/ai-models/{task}` | `{provider, model_name}` |
| GET | `/admin/tool-configs/{tool}` | effective config (defaults merged) |
| PUT | `/admin/tool-configs/{tool}` | save JSONB overrides (validated vs tool schema) |
| GET | `/admin/model-settings` / PUT | global + advanced fallback model |

## files.py (admin uploads)
| Method | Path | Notes |
|---|---|---|
| POST | `/admin/files/master` | upload + validate Scrip Master CSV |
| POST | `/admin/files/company-logo` | image |
| POST | `/admin/files/font` | regular/bold ttf |
| GET | `/admin/files` | list active by type |
| DELETE | `/admin/files/{id}` | deactivate |

## pdf_template.py (admin only)
| Method | Path | Notes |
|---|---|---|
| GET | `/admin/pdf-template` | latest |
| PUT | `/admin/pdf-template` | upsert HTML fields |

## analysts.py (admin write, all read)
| Method | Path | Notes |
|---|---|---|
| GET | `/analysts` | list |
| POST | `/analysts` | name, aliases, avatar |
| PATCH | `/analysts/{id}` | edit |
| DELETE | `/analysts/{id}` | soft delete |

## youtube.py
| Method | Path | Notes |
|---|---|---|
| GET | `/youtube/metadata?url=` | auth → `{channel, upload_date, upload_time, title}` via Data API v3 |

## jobs.py (Media Presence + pipeline control)
| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/jobs` | auth | list (Media Presence rows): platform, channel, datetime, status, pdf, actions |
| POST | `/jobs` | auth | multipart: platform_id, channel_id, analyst_id, extract_all_stocks, youtube_url, title, video_date, video_time, audio file → status `pending` |
| GET | `/jobs/{id}` | auth | detail incl. steps |
| PATCH | `/jobs/{id}` | auth | edit metadata |
| DELETE | `/jobs/{id}` | auth | delete job + files |
| POST | `/jobs/{id}/start` | auth | begin pipeline (enqueue) |
| POST | `/jobs/{id}/restart` | auth | clear + run from step 1 |
| POST | `/jobs/{id}/resume` | auth | continue after a gate |
| POST | `/jobs/{id}/retry-step` | auth | `{step_no}` re-run a failed step |
| POST | `/jobs/{id}/save` | auth | mark `saved` (→ Saved Rationale) |
| GET | `/jobs/{id}/steps` | auth | step statuses + logs |
| GET | `/jobs/{id}/artifact?key=` | auth | signed download of an intermediate artifact |
| GET | `/jobs/{id}/pdf` | auth | download final PDF |

### Review-gate endpoints
| Method | Path | Gate | Body |
|---|---|---|---|
| GET | `/jobs/{id}/review/extract` | extract_review | returns editable extracted text |
| POST | `/jobs/{id}/review/extract` | | `{text}` → save + resume to Step 5 |
| GET | `/jobs/{id}/review/mapping` | mapping_review | returns mapped CSV as rows |
| POST | `/jobs/{id}/review/mapping` | | `{rows}` → write CSV + resume to Step 8 |
| GET | `/jobs/{id}/review/charts` | chart_upload | returns `failed_charts.json` list |
| POST | `/jobs/{id}/review/charts` | | multipart: per-stock image uploads → resume to Step 10 |

## chart_tool.py (standalone Generate Chart)
| Method | Path | Notes |
|---|---|---|
| POST | `/tools/generate-chart` | `{stock, security_id?, exchange, date, time, chart_type}` → PNG download/url |

## saved.py
| Method | Path | Notes |
|---|---|---|
| GET | `/saved` | jobs where status='saved' |
| DELETE | `/saved/{id}` | remove |

## WebSocket
```
WS /ws/jobs/{job_id}    (auth via query token)
→ server events:
  { "type": "step", "step_no": 4, "step_key": "extract", "status": "running" }
  { "type": "log",  "step_no": 4, "line": "🎤 Detecting speakers in 3 chunk(s)" }
  { "type": "gate", "gate": "extract_review" }
  { "type": "done", "status": "completed", "pdf_url": "..." }
  { "type": "error","step_no": 8, "message": "Dhan ..." }
```
Fallback: `GET /jobs/{id}/steps` polling if WS unavailable.

## Validation & deps
- Pydantic v2 schemas in `backend/schemas/`.
- Deps in `core/deps.py`: `get_db`, `get_current_user`, `require_admin`.
- Rate-limit `/auth/login` and AI-test endpoints.
