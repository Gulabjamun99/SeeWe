#!/usr/bin/env python3
"""Dark-mode class retrofit (Task 2-b remainder). Mechanical, additive-only:
for each light-only utility class, append a dark: variant. Never touches light
classes; skips tokens that already carry a `dark:`-prefixed duplicate of the
same property by checking the surrounding class string segment."""

import re, sys

# (pattern, replacement-template) — \1 preserves submatches (opacity suffixes etc.)
RULES = [
    # text greys
    (r'(?<![-:\w])text-slate-900\b', 'text-slate-900 dark:text-slate-100'),
    (r'(?<![-:\w])text-slate-800\b', 'text-slate-800 dark:text-slate-200'),
    (r'(?<![-:\w])text-slate-700\b', 'text-slate-700 dark:text-slate-300'),
    (r'(?<![-:\w])text-slate-600\b', 'text-slate-600 dark:text-slate-400'),
    (r'(?<![-:\w])text-slate-500\b', 'text-slate-500 dark:text-slate-400'),
    (r'(?<![-:\w])text-slate-400\b', 'text-slate-400 dark:text-slate-500'),
    (r'(?<![-:\w])text-gray-700\b', 'text-gray-700 dark:text-gray-300'),
    (r'(?<![-:\w])text-gray-600\b', 'text-gray-600 dark:text-gray-400'),
    (r'(?<![-:\w])text-gray-500\b', 'text-gray-500 dark:text-gray-400'),
    # surfaces
    (r'(?<![-:\w])bg-white\b(?!/)', 'bg-white dark:bg-slate-900'),
    (r'(?<![-:\w])bg-slate-50\b(?!/)', 'bg-slate-50 dark:bg-slate-800/60'),
    (r'(?<![-:\w])bg-slate-100\b(?!/)', 'bg-slate-100 dark:bg-slate-800'),
    (r'(?<![-:\w])bg-slate-200\b(?!/)', 'bg-slate-200 dark:bg-slate-700'),
    (r'(?<![-:\w])bg-gray-50\b(?!/)', 'bg-gray-50 dark:bg-gray-800/60'),
    (r'(?<![-:\w])bg-gray-100\b(?!/)', 'bg-gray-100 dark:bg-gray-800'),
    (r'(?<![-:\w])bg-gray-200\b(?!/)', 'bg-gray-200 dark:bg-gray-700'),
    # borders + dividers
    (r'(?<![-:\w])border-slate-200\b(?!/)', 'border-slate-200 dark:border-slate-800'),
    (r'(?<![-:\w])border-slate-100\b(?!/)', 'border-slate-100 dark:border-slate-800/60'),
    (r'(?<![-:\w])border-slate-300\b(?!/)', 'border-slate-300 dark:border-slate-700'),
    (r'(?<![-:\w])divide-slate-200\b(?!/)', 'divide-slate-200 dark:divide-slate-800'),
    (r'(?<![-:\w])divide-slate-100\b(?!/)', 'divide-slate-100 dark:divide-slate-800/60'),
    (r'(?<![-:\w])ring-slate-200\b(?!/)', 'ring-slate-200 dark:ring-slate-800'),
    # brand washes (keep opacity suffix when present)
    (r'(?<![-:\w])bg-blue-50(/(\d+))?\b', r'bg-blue-50\1 dark:bg-blue-950/40'),
    (r'(?<![-:\w])bg-blue-100(/(\d+))?\b', r'bg-blue-100\1 dark:bg-blue-900/40'),
    (r'(?<![-:\w])bg-sky-50(/(\d+))?\b', r'bg-sky-50\1 dark:bg-sky-950/40'),
    (r'(?<![-:\w])bg-sky-100(/(\d+))?\b', r'bg-sky-100\1 dark:bg-sky-900/40'),
    (r'(?<![-:\w])border-blue-100(/(\d+))?\b', r'border-blue-100\1 dark:border-blue-900/60'),
    (r'(?<![-:\w])border-blue-200(/(\d+))?\b', r'border-blue-200\1 dark:border-blue-900/70'),
    (r'(?<![-:\w])border-sky-100(/(\d+))?\b', r'border-sky-100\1 dark:border-sky-900/60'),
    (r'(?<![-:\w])border-sky-200(/(\d+))?\b', r'border-sky-200\1 dark:border-sky-900/70'),
    (r'(?<![-:\w])ring-blue-100(/(\d+))?\b', r'ring-blue-100\1 dark:ring-blue-900/60'),
    # gradient stops
    (r'(?<![-:\w])from-blue-50(/(\d+))?\b', r'from-blue-50\1 dark:from-blue-950/40'),
    (r'(?<![-:\w])via-blue-50(/(\d+))?\b', r'via-blue-50\1 dark:via-blue-950/30'),
    (r'(?<![-:\w])from-sky-50(/(\d+))?\b', r'from-sky-50\1 dark:from-sky-950/40'),
    (r'(?<![-:\w])via-sky-50(/(\d+))?\b', r'via-sky-50\1 dark:via-sky-950/30'),
    (r'(?<![-:\w])to-sky-50(/(\d+))?\b', r'to-sky-50\1 dark:to-sky-950/40'),
    (r'(?<![-:\w])to-blue-50(/(\d+))?\b', r'to-blue-50\1 dark:to-blue-950/40'),
    (r'(?<![-:\w])to-white\b(?!/)', 'to-white dark:to-slate-900'),
    (r'(?<![-:\w])from-slate-50\b(?!/)', 'from-slate-50 dark:from-slate-900'),
    (r'(?<![-:\w])to-slate-50\b(?!/)', 'to-slate-50 dark:to-slate-900'),
    # status: amber
    (r'(?<![-:\w])bg-amber-50(/(\d+))?\b', r'bg-amber-50\1 dark:bg-amber-950/40'),
    (r'(?<![-:\w])bg-amber-100(/(\d+))?\b', r'bg-amber-100\1 dark:bg-amber-900/40'),
    (r'(?<![-:\w])border-amber-200(/(\d+))?\b', r'border-amber-200\1 dark:border-amber-900/60'),
    (r'(?<![-:\w])border-amber-300(/(\d+))?\b', r'border-amber-300\1 dark:border-amber-700/60'),
    (r'(?<![-:\w])text-amber-600\b(?!/)', 'text-amber-600 dark:text-amber-300'),
    (r'(?<![-:\w])text-amber-700\b(?!/)', 'text-amber-700 dark:text-amber-300'),
    (r'(?<![-:\w])text-amber-800\b(?!/)', 'text-amber-800 dark:text-amber-200'),
    # status: rose
    (r'(?<![-:\w])bg-rose-50(/(\d+))?\b', r'bg-rose-50\1 dark:bg-rose-950/40'),
    (r'(?<![-:\w])bg-rose-100(/(\d+))?\b', r'bg-rose-100\1 dark:bg-rose-900/40'),
    (r'(?<![-:\w])border-rose-200(/(\d+))?\b', r'border-rose-200\1 dark:border-rose-900/60'),
    (r'(?<![-:\w])border-rose-300(/(\d+))?\b', r'border-rose-300\1 dark:border-rose-700/60'),
    (r'(?<![-:\w])text-rose-600\b(?!/)', 'text-rose-600 dark:text-rose-300'),
    (r'(?<![-:\w])text-rose-700\b(?!/)', 'text-rose-700 dark:text-rose-300'),
    (r'(?<![-:\w])text-rose-800\b(?!/)', 'text-rose-800 dark:text-rose-200'),
    # status: emerald / green
    (r'(?<![-:\w])bg-emerald-50(/(\d+))?\b', r'bg-emerald-50\1 dark:bg-emerald-950/40'),
    (r'(?<![-:\w])bg-emerald-100(/(\d+))?\b', r'bg-emerald-100\1 dark:bg-emerald-900/40'),
    (r'(?<![-:\w])border-emerald-200(/(\d+))?\b', r'border-emerald-200\1 dark:border-emerald-900/60'),
    (r'(?<![-:\w])text-emerald-600\b(?!/)', 'text-emerald-600 dark:text-emerald-300'),
    (r'(?<![-:\w])text-emerald-700\b(?!/)', 'text-emerald-700 dark:text-emerald-300'),
    (r'(?<![-:\w])text-emerald-800\b(?!/)', 'text-emerald-800 dark:text-emerald-200'),
    (r'(?<![-:\w])bg-green-50(/(\d+))?\b', r'bg-green-50\1 dark:bg-green-950/40'),
    (r'(?<![-:\w])bg-green-100(/(\d+))?\b', r'bg-green-100\1 dark:bg-green-900/40'),
    (r'(?<![-:\w])border-green-200(/(\d+))?\b', r'border-green-200\1 dark:border-green-900/60'),
    (r'(?<![-:\w])text-green-600\b(?!/)', 'text-green-600 dark:text-green-300'),
    (r'(?<![-:\w])text-green-700\b(?!/)', 'text-green-700 dark:text-green-300'),
    (r'(?<![-:\w])text-green-800\b(?!/)', 'text-green-800 dark:text-green-200'),
    # hovers on light tints
    (r'(?<![-:\w])hover:bg-slate-50\b(?!/)', 'hover:bg-slate-50 dark:hover:bg-slate-800/60'),
    (r'(?<![-:\w])hover:bg-slate-100\b(?!/)', 'hover:bg-slate-100 dark:hover:bg-slate-800'),
    (r'(?<![-:\w])hover:bg-blue-50\b(?!/)', 'hover:bg-blue-50 dark:hover:bg-blue-950/40'),
    (r'(?<![-:\w])hover:bg-sky-50\b(?!/)', 'hover:bg-sky-50 dark:hover:bg-sky-950/40'),
]

FILES = [
    'src/components/seewee/CompanyDialog.tsx',
    'src/components/seewee/DigestEmailDialog.tsx',
    'src/components/seewee/JobAlertsBell.tsx',
    'src/components/seewee/JobDetailDialog.tsx',
    'src/components/seewee/JobsView.tsx',
    'src/components/seewee/NotificationBell.tsx',
    'src/components/seewee/SaveJobButton.tsx',
    'src/components/seewee/AuthDialog.tsx',
    'src/components/seewee/AdminView.tsx',
    'src/components/seewee/interview/AIReportCard.tsx',
    'src/components/seewee/interview/InterviewRoom.tsx',
    'src/components/seewee/interview/InterviewTranscript.tsx',
    'src/components/seewee/recruiter/ApplicantsPanel.tsx',
    'src/components/seewee/recruiter/ClientReports.tsx',
    'src/components/seewee/recruiter/ClientsPanel.tsx',
    'src/components/seewee/recruiter/MyJobsPanel.tsx',
    'src/components/seewee/recruiter/PostJobForm.tsx',
    'src/components/seewee/recruiter/RecordingsPanel.tsx',
    'src/components/seewee/recruiter/RecruiterDashboard.tsx',
    'src/components/seewee/recruiter/TalentSearch.tsx',
    'src/components/seewee/recruiter/RecruiterAnalytics.tsx',
]

def has_dark_sibling(segment: str) -> bool:
    """segment = the full className string value around the match. True when a
    dark: variant of the same property already exists (bg-/text-/border-...)."""
    return bool(re.search(r'\bdark:(bg|text|border|ring|from|via|to|divide)-', segment))

def main():
    dry = '--dry' in sys.argv
    for f in FILES:
        src = open(f).read()
        out = src
        # className segment finder: split on quotes boundaries to bound the "sibling" scan
        count = 0
        for pat, repl in RULES:
            def apply(m):
                nonlocal count
                start = m.start()
                # bound scan: nearest quote before/after the match
                q_before = max(out.rfind('"', 0, start), out.rfind("'", 0, start), out.rfind('`', 0, start))
                q_after = min([q for q in (out.find('"', start), out.find("'", start), out.find('`', start)) if q != -1] or [len(out)])
                segment = out[q_before:q_after]
                if has_dark_sibling(segment):
                    return m.group(0)
                count += 1
                return m.expand(repl)
            out = re.sub(pat, apply, out)
        if count and not dry:
            open(f, 'w').write(out)
        print(f'{f}: {count} additions')

if __name__ == '__main__':
    main()
