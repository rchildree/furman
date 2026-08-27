Drop attachments here (study guides, handouts, slides, etc.) and link
to them from schedule.yaml with a path relative to this course folder:

    links:
      - text: Study guide
        url: files/exam1-guide.pdf

HTML handouts in this folder can reuse the site's local fonts by adding
this in the document `<head>`:

    <link rel="stylesheet" href="../../../assets/styles.css">

Then use the existing font stacks in CSS:

    body { font-family: var(--serif); }
    .ui-label { font-family: var(--sans); }

This file itself isn't linked from anywhere — delete it once you've
added a real attachment, or leave it, it won't show up on the site.
