#!/usr/bin/env python3
"""Final integration regression sweep — all new surfaces from this round."""
import json, urllib.request, sys

BASE = "http://localhost:3000"
results = []

def api(path, method="GET", body=None, raw=False):
    req = urllib.request.Request(BASE + path, method=method)
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, data=data, timeout=60) as r:
            payload = r.read()
            if raw:
                return r.status, len(payload), r.headers.get("Content-Type", "")
            return r.status, json.loads(payload.decode())
    except urllib.error.HTTPError as e:
        try:
            payload = e.read()
            if raw:
                return e.code, len(payload), ""
            return e.code, json.loads(payload.decode())
        except Exception:
            return e.code, {}
    except Exception as ex:
        return 0, {"exception": str(ex)}

def check(name, ok, detail=""):
    results.append(ok)
    print(("PASS" if ok else "FAIL"), name, detail)

# --- companies (2-a)
st, d = api("/api/companies")
ok = st == 200 and isinstance(d.get("data"), list) and len(d["data"]) >= 3
check("GET /api/companies aggregate", ok, f"{len(d.get('data', []))} companies")
top = (d.get("data") or [{}])[0].get("name", "")
st, d = api(f"/api/companies?name={urllib.request.quote(top)}")
check("GET /api/companies?name detail", st == 200 and len(d.get("data", {}).get("jobs", [])) >= 1, top)
st, d = api("/api/companies?name=No%20Such%20Company%20GmbH")
check("companies unknown -> 404", st == 404)

# --- clients + retention (2-d)
st, d = api("/api/clients")
clients = d.get("data", [])
check("GET /api/clients", st == 200 and len(clients) >= 3)
cid = clients[0]["id"]
st, d = api("/api/clients", "PATCH", {"id": cid, "mediaRetentionDays": 30})
check("PATCH clients 30d", st == 200 and d["data"]["mediaRetentionDays"] == 30)
st, d = api("/api/clients", "PATCH", {"id": cid, "mediaRetentionDays": 0})
check("PATCH clients 0 -> 400", st == 400)
st, d = api("/api/clients", "PATCH", {"id": cid, "mediaRetentionDays": None})
check("PATCH clients reset null", st == 200 and d["data"]["mediaRetentionDays"] is None)
st, d = api("/api/clients", "PATCH", {"id": "bogus", "mediaRetentionDays": 30})
check("PATCH clients bogus -> 404", st == 404)

# --- media-gc response shape (2-d)
st, cand = api("/api/candidates")
cid2 = cand["data"][0]["id"]
st, d = api(f"/api/interview/media-gc?candidateId={cid2}", "POST")
ok = st == 200 and "defaultTtlDays" in d.get("data", {}) and "clientOverrides" in d.get("data", {})
check("media-gc new fields", ok, str(d.get("data", {}))[:80])
st, d = api("/api/interview/media-gc?candidateId=fake", "POST")
check("media-gc fake scope -> 404", st == 404)

# --- admin stats (2-e)
st, d = api("/api/auth/login", "POST", {"email": "admin@seewee.ai", "role": "ADMIN"})
check("admin login", st == 200 and d["data"]["role"] == "ADMIN")
admin_id = d["data"]["id"]
st, d = api(f"/api/admin/stats?adminId={admin_id}")
pl = d.get("data", {}).get("platform", {})
ok = st == 200 and pl.get("usersTotal", 0) >= 15 and pl.get("jobsTotal", 0) >= 11
check("admin stats real numbers", ok, f"users={pl.get('usersTotal')} jobs={pl.get('jobsTotal')} apps={pl.get('applicationsTotal')}")
st, d = api(f"/api/admin/stats?adminId={cid2}")
check("admin stats non-admin -> 403", st == 403)
st, d = api("/api/admin/stats")
check("admin stats no id -> 400", st == 400)

# --- client portal + zip (2-d)
flip = next((c for c in clients if "lipkart" in c["name"]), clients[0])
st, d = api(f"/api/client-portal?clientId={flip['id']}")
reports = d.get("data", {}).get("reports", []) if st == 200 else []
check("client portal reports", st == 200, f"{len(reports)} reports")
if reports:
    r0 = reports[0]
    check("report has recordingsCount", "recordingsCount" in r0)
    st, size, ct = api(f"/api/interview/media-zip?clientId={flip['id']}&shortlistId={r0['shortlistId']}", raw=True)
    check("client ZIP download", st == 200 and ct == "application/zip" and size > 10000, f"{size}B {ct}")
st, size, ct = api(f"/api/interview/media-zip?clientId={flip['id']}&shortlistId=bogus", raw=True)
check("client ZIP bogus shortlist -> 404", st == 404)

# --- core legacy regression
st, d = api("/api/jobs?limit=5")
check("jobs list", st == 200 and len(d["data"]["jobs"]) == 5)
st, d = api(f"/api/applications?candidateId={cid2}")
check("applications scoped", st == 200)
st, d = api("/api/interview/media-list?candidateId=fake-uid")
check("media-list fake -> 4xx", 400 <= st < 500, str(st))
st, d = api(f"/api/interview/media-list?candidateId={cid2}")
check("media-list 200", st == 200)

failed = results.count(False)
print(f"\nSUMMARY: {len(results) - failed}/{len(results)} passed")
sys.exit(1 if failed else 0)
