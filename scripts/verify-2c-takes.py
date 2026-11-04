#!/usr/bin/env python3
"""Task 2-c verification: A/B take label end-to-end API test + cleanup."""
import json, urllib.request, sys

BASE = "http://localhost:3000"

def api(path, method="GET", body=None):
    req = urllib.request.Request(BASE + path, method=method)
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, data=data, timeout=120) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode())
        except Exception:
            return e.code, {}

def main():
    results = []

    def check(name, ok, detail=""):
        results.append((name, ok, detail))
        print(("PASS" if ok else "FAIL"), name, detail)

    # 1. pick demo candidate + ACTIVE job
    st, cand = api("/api/candidates")
    cands = cand.get("data", [])
    check("candidates list", st == 200 and len(cands) > 0)
    # use a candidate unlikely to collide with existing applications
    target = None
    for c in cands:
        if c.get("skills") and "React" in c["skills"]:
            target = c
            break
    target = target or cands[0]
    cid = target["id"]

    st, jobs = api("/api/jobs?limit=20")
    check("jobs list", st == 200 and len(jobs.get("data", {}).get("jobs", [])) > 0)
    # pick a job where this candidate has NOT applied
    applied_jobs = set()
    st, apps = api(f"/api/applications?candidateId={cid}")
    if st == 200:
        applied_jobs = {a["jobId"] for a in apps.get("data", []) if isinstance(a, dict)}
    all_jobs = jobs["data"]["jobs"]
    job = next((j for j in all_jobs if j["id"] not in applied_jobs and j.get("status", "ACTIVE") == "ACTIVE"), None)
    if job is None:
        # fall back: another candidate
        for c in cands:
            if c["id"] == cid:
                continue
            st, apps2 = api(f"/api/applications?candidateId={c['id']}")
            used = {a["jobId"] for a in apps2.get("data", []) if isinstance(a, dict)} if st == 200 else set()
            job = next((j for j in all_jobs if j["id"] not in used), None)
            if job:
                cid = c["id"]
                break
    check("eligible job found", job is not None, f"candidate={cid}")
    jid = job["id"]

    # 2. create application
    st, app = api("/api/applications", "POST", {"jobId": jid, "candidateId": cid, "coverNote": "QA take-picker test"})
    check("create application", st in (200, 201), str(st))
    app_id = app["data"]["id"]

    # 3. start interview (auto-creates shortlist, LLM call)
    st, iv = api("/api/interview/start", "POST", {"applicationId": app_id})
    check("interview start", st == 200 and iv.get("data", {}).get("id"), str(st))
    iv_id = iv["data"]["id"]
    nq = len(iv["data"].get("questions", []))
    check("interview questions", nq >= 4, f"nq={nq}")

    # 4. answer q0 as Take A (non-meaningful transcript -> skips LLM, fast)
    st, a1 = api("/api/interview/answer", "POST", {
        "interviewId": iv_id, "qIndex": 0, "transcript": "n a",
        "audioPresent": True, "takeLabel": "A", "mediaSeconds": 12.4,
    })
    check("answer q0 takeLabel=A", st == 200 and a1.get("data", {}).get("takeLabel") == "A", str(st))

    # 5. re-answer q0 as Take B (meaningful -> LLM evaluates; upsert path)
    st, a2 = api("/api/interview/answer", "POST", {
        "interviewId": iv_id, "qIndex": 0, "transcript":
        "In React, useState creates a state slot and the setter schedules a re-render; "
        "useEffect handles side effects with a dependency array controlling reruns.",
        "audioPresent": True, "takeLabel": "b", "mediaSeconds": 18.9,
    })
    check("answer q0 re-take takeLabel=b (clamped to B)", st == 200 and a2.get("data", {}).get("takeLabel") == "B", str(st))
    check("same answer row upserted", a1.get("data", {}).get("id") == a2.get("data", {}).get("id"))

    # 6. invalid takeLabel clamps to null
    st, a3 = api("/api/interview/answer", "POST", {
        "interviewId": iv_id, "qIndex": 0, "transcript": "x", "takeLabel": "C",
    })
    check("invalid takeLabel 'C' -> null", st == 200 and a3.get("data", {}).get("takeLabel") is None, str(st))

    # 7. legacy path: q1 without takeLabel -> null
    st, a4 = api("/api/interview/answer", "POST", {
        "interviewId": iv_id, "qIndex": 1, "transcript": "n a", "audioPresent": False,
    })
    check("legacy answer without takeLabel -> null", st == 200 and a4.get("data", {}).get("takeLabel") is None, str(st))

    # 8. GET interview detail returns takeLabel
    st, iv2 = api(f"/api/interview/{iv_id}")
    ans = {a["qIndex"]: a for a in iv2.get("data", {}).get("answers", [])}
    check("GET interview has takeLabel fields", st == 200 and "takeLabel" in ans.get(0, {}) and "takeLabel" in ans.get(1, {}))

    # 9. media-list includes takeLabel (empty media here, just verify 200 + field presence on items when any)
    st, ml = api(f"/api/interview/media-list?candidateId={cid}")
    check("media-list 200 after takeLabel change", st == 200, str(st))

    # 10. CLEANUP: delete application (cascades shortlist->interview->answers)
    st, _ = api(f"/api/applications/{app_id}", "DELETE")
    check("delete test application", st in (200, 204), str(st))

    # verify cascade
    st, iv3 = api(f"/api/interview/{iv_id}")
    check("test interview cascaded away", st == 404, str(st))

    # clean test notifications referencing the test application
    import sqlite3
    con = sqlite3.connect("/home/z/my-project/db/custom.db")
    cur = con.execute("DELETE FROM Notification WHERE meta LIKE ?", (f'%{app_id}%',))
    con.commit()
    print(f"notifications cleaned: {cur.rowcount}")
    con.close()

    failed = [r for r in results if not r[1]]
    print(f"\nSUMMARY: {len(results) - len(failed)}/{len(results)} passed")
    sys.exit(1 if failed else 0)

if __name__ == "__main__":
    main()
