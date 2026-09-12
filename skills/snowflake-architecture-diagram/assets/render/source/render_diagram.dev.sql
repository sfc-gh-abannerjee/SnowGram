CREATE OR REPLACE FUNCTION "RENDER_DIAGRAM"("LAYOUT_JSON" VARCHAR, "ENRICH_JSON" VARCHAR, "TITLE" VARCHAR, "HTML_LAYOUT_JSON" VARCHAR DEFAULT NULL)
RETURNS VARIANT
LANGUAGE PYTHON
RUNTIME_VERSION = '3.11'
HANDLER = 'run'
COMMENT='Renderer: theme-aware logo (white in colored header, color on white svg/drawio); interactive html; static svg/drawio/mmd w/ doc+sources.'
AS $$
import json, base64
_INTERACT_CSS = base64.b64decode('LyogaW50ZXJhY3Rpdml0eS5jc3Mg4oCUIG1vdGlvbiArIGNvbXBvbmVudCBoaWdobGlnaHRpbmcgZm9yIFNub3dHcmFtIGRpYWdyYW1zLgogKgogKiBFeHRyYWN0ZWQgZnJvbSB0aGUgU25vd0dyYW0gdmlld2VyIChhc3NldHMvdmlld2VyL2luZGV4Lmh0bWwpLiBEcm9wIHRoaXMKICogaW50byBhbnkgcGFnZSB0aGF0IHJlbmRlcnMgYSBkaWFncmFtIHdpdGggdGhlIGNsYXNzIGNvbnRyYWN0IGRlc2NyaWJlZCBpbgogKiBSRUFETUUubWQsIHRoZW4gY2FsbCBhdHRhY2hEaWFncmFtSW50ZXJhY3Rpdml0eSgpIGZyb20gaW50ZXJhY3Rpdml0eS5qcy4KICoKICogVGhlbWluZzogb3ZlcnJpZGUgdGhlIENTUyB2YXJpYWJsZXMgYmVsb3cgKG9yIHNldCB0aGVtIG9uIGEgcGFyZW50KS4KICogQXV0aG9yOiBBYmhpbmF2IEJhbm5lcmplZQogKi8KCjpyb290IHsKICAtLWNvbm5lY3Rvci1jb2xvcjogIzhhYTBiNDsgICAgIC8qIGlkbGUgY29ubmVjdG9yIHN0cm9rZSAqLwogIC0tYWNjZW50OiAjNmNiOWZmOyAgICAgICAgICAgICAgLyogaGlnaGxpZ2h0ZWQgKGNvbm5lY3RlZCkgZWxlbWVudHMgKi8KICAtLXByaW1hcnktaG92ZXI6ICNmZmI0NTQ7ICAgICAgIC8qIHRoZSBlbGVtZW50IHRoZSBjdXJzb3IgaXMgZGlyZWN0bHkgb3ZlciAqLwp9CgovKiDilIDilIAgQ29ubmVjdG9ycyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIAgKi8KCi8qIFZpc2libGUgYW5pbWF0ZWQgY29ubmVjdG9yOiBkYXNoZWQgbGluZSB3aG9zZSBkYXNoZXMgImZsb3ciIHRvd2FyZCB0aGUKICogdGFyZ2V0ICh0aGUgbW90aW9uKS4gKi8KLmNvbm5lY3Rvci1wYXRoIHsKICBmaWxsOiBub25lOwogIHN0cm9rZTogdmFyKC0tY29ubmVjdG9yLWNvbG9yKTsKICBzdHJva2Utd2lkdGg6IDEuMzsKICBzdHJva2UtZGFzaGFycmF5OiA1IDQ7CiAgc3Ryb2tlLWxpbmVjYXA6IHJvdW5kOwogIHN0cm9rZS1saW5lam9pbjogcm91bmQ7CiAgb3BhY2l0eTogMC43OwogIGFuaW1hdGlvbjogY29ubmVjdG9yLWZsb3cgMS4ycyBsaW5lYXIgaW5maW5pdGU7CiAgdHJhbnNpdGlvbjogc3Ryb2tlLXdpZHRoIDEyMG1zIGVhc2UsIG9wYWNpdHkgMTIwbXMgZWFzZSwgc3Ryb2tlIDEyMG1zIGVhc2U7CiAgcG9pbnRlci1ldmVudHM6IHN0cm9rZTsKICBjdXJzb3I6IHBvaW50ZXI7Cn0KCi8qIFdpZGVyIGludmlzaWJsZSBoaXQgYXJlYSBwYWlyZWQgd2l0aCBlYWNoIHZpc2libGUgY29ubmVjdG9yIHNvIHRoZSB0aGluCiAqIGRhc2hlZCBzdHJva2UgaXMgZWFzeSB0byBob3Zlci4gKi8KLmNvbm5lY3Rvci1oaXQgewogIGZpbGw6IG5vbmU7CiAgc3Ryb2tlOiB0cmFuc3BhcmVudDsKICBzdHJva2Utd2lkdGg6IDE0OwogIHBvaW50ZXItZXZlbnRzOiBzdHJva2U7CiAgY3Vyc29yOiBwb2ludGVyOwp9CgovKiBIb3ZlcmluZyBhbnl3aGVyZSBpbiB0aGUgZ3JvdXAgKGhpdCBhcmVhIG9yIHBhdGgpIOKAlCBvciB0aGUgZ3JvdXAgYmVpbmcKICogbWFya2VkIC5pcy1hY3RpdmUgYnkgSlMg4oCUIGhpZ2hsaWdodHMgdGhlIHZpc2libGUgY29ubmVjdG9yOiBhY2NlbnQgY29sb3IsCiAqIHRoaWNrZXIsIHNvbGlkLCBtb3Rpb24gcGF1c2VkLiAqLwouY29ubmVjdG9yLWdyb3VwOmhvdmVyIC5jb25uZWN0b3ItcGF0aCwKLmNvbm5lY3Rvci1ncm91cC5pcy1hY3RpdmUgLmNvbm5lY3Rvci1wYXRoIHsKICBzdHJva2U6IHZhcigtLWFjY2VudCk7CiAgc3Ryb2tlLXdpZHRoOiAyLjQ7CiAgb3BhY2l0eTogMTsKICBzdHJva2UtZGFzaGFycmF5OiBub25lOwogIGFuaW1hdGlvbjogbm9uZTsKfQoKLmNvbm5lY3Rvci1kb3QgewogIGZpbGw6IHZhcigtLWNvbm5lY3Rvci1jb2xvcik7CiAgb3BhY2l0eTogMC44Owp9CgpAa2V5ZnJhbWVzIGNvbm5lY3Rvci1mbG93IHsgdG8geyBzdHJva2UtZGFzaG9mZnNldDogLTIwOyB9IH0KCi8qIOKUgOKUgCBDb21wb25lbnQgKG5vZGUpIGhpZ2hsaWdodGluZyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIAgKi8KCi5mbG93LW5vZGUgewogIHRyYW5zaXRpb246IGJveC1zaGFkb3cgMTIwbXMgZWFzZSwgYm9yZGVyLWNvbG9yIDEyMG1zIGVhc2U7Cn0KCi8qIEEgbm9kZSBjb25uZWN0ZWQgdG8gdGhlIGhvdmVyZWQgZWxlbWVudC4gKi8KLmZsb3ctbm9kZS5pcy1hY3RpdmUgewogIGJveC1zaGFkb3c6IDAgMCAwIDJweCB2YXIoLS1hY2NlbnQpLCAwIDAgMThweCByZ2JhKDEwOCwgMTg1LCAyNTUsIDAuNDUpOwogIGJvcmRlci1jb2xvcjogdmFyKC0tYWNjZW50KTsKICB0cmFuc2l0aW9uOiBib3gtc2hhZG93IDEyMG1zIGVhc2UsIGJvcmRlci1jb2xvciAxMjBtcyBlYXNlOwogIGN1cnNvcjogcG9pbnRlcjsKfQoKLyogVGhlIG5vZGUgdGhlIGN1cnNvciBpcyBkaXJlY3RseSBvdmVyIOKAlCBkaXN0aW5jdCBjb2xvciBzbyB0aGUgZm9jdXMgaXMKICogb2J2aW91cyB2cy4gaXRzIG1lcmVseS1jb25uZWN0ZWQgbmVpZ2hib3JzLiBXaW5zIG92ZXIgLmlzLWFjdGl2ZS4gKi8KLmZsb3ctbm9kZS5pcy1wcmltYXJ5LAouZmxvdy1ub2RlLmlzLWFjdGl2ZS5pcy1wcmltYXJ5IHsKICBib3gtc2hhZG93OgogICAgMCAwIDAgMnB4IHZhcigtLXByaW1hcnktaG92ZXIpLAogICAgMCAwIDIycHggcmdiYSgyNTUsIDE4MCwgODQsIDAuNTUpOwogIGJvcmRlci1jb2xvcjogdmFyKC0tcHJpbWFyeS1ob3Zlcik7CiAgdHJhbnNpdGlvbjogYm94LXNoYWRvdyAxMjBtcyBlYXNlLCBib3JkZXItY29sb3IgMTIwbXMgZWFzZTsKICBjdXJzb3I6IHBvaW50ZXI7Cn0KCi8qIFJlc3BlY3QgdXNlcnMgd2hvIHByZWZlciByZWR1Y2VkIG1vdGlvbjogc3RvcCB0aGUgZmxvd2luZyBkYXNoZXMuICovCkBtZWRpYSAocHJlZmVycy1yZWR1Y2VkLW1vdGlvbjogcmVkdWNlKSB7CiAgLmNvbm5lY3Rvci1wYXRoIHsgYW5pbWF0aW9uOiBub25lOyB9Cn0K').decode('utf-8')
_INTERACT_JS = base64.b64decode('Ly8gaW50ZXJhY3Rpdml0eS5qcyDigJQgd2lyZSBob3ZlciBtb3Rpb24gKyBjb21wb25lbnQgaGlnaGxpZ2h0aW5nIG9udG8gYQovLyByZW5kZXJlZCBTbm93R3JhbSBkaWFncmFtLiBGcmFtZXdvcmstYWdub3N0aWMsIHplcm8gZGVwZW5kZW5jaWVzLgovLwovLyBFeHRyYWN0ZWQgZnJvbSB0aGUgU25vd0dyYW0gdmlld2VyIChhc3NldHMvdmlld2VyL2luZGV4Lmh0bWwpLiBQYWlycyB3aXRoCi8vIGludGVyYWN0aXZpdHkuY3NzLiBTZWUgUkVBRE1FLm1kIGZvciB0aGUgcmVxdWlyZWQgY2xhc3MvYXR0cmlidXRlIGNvbnRyYWN0LgovLwovLyBVc2FnZSAoYnJvd3Nlcik6Ci8vICAgPGxpbmsgcmVsPSJzdHlsZXNoZWV0IiBocmVmPSJpbnRlcmFjdGl2aXR5LmNzcyI+Ci8vICAgPHNjcmlwdCBzcmM9ImludGVyYWN0aXZpdHkuanMiPjwvc2NyaXB0PgovLyAgIDxzY3JpcHQ+Ci8vICAgICBjb25zdCBvZmYgPSBhdHRhY2hEaWFncmFtSW50ZXJhY3Rpdml0eShkaWFncmFtQ29udGFpbmVyRWwsIGNvbm5lY3RvcnNTdmdFbCk7Ci8vICAgICAvLyAuLi4gbGF0ZXIsIGlmIHlvdSByZS1yZW5kZXI6IG9mZigpOyBhdHRhY2hEaWFncmFtSW50ZXJhY3Rpdml0eSguLi4pOwovLyAgIDwvc2NyaXB0PgovLwovLyBBbHNvIGV4cG9zZWQgYXMgd2luZG93LlNub3dHcmFtSW50ZXJhY3Rpdml0eSA9IHsgYXR0YWNoLCBkZXRhY2ggfSBhbmQgYXMgYW4KLy8gRVMgbW9kdWxlIGV4cG9ydCB3aGVuIGltcG9ydGVkLgovLwovLyBBdXRob3I6IEFiaGluYXYgQmFubmVyamVlCgooZnVuY3Rpb24gKHJvb3QpIHsKICAvLyBIaWdobGlnaHQgYSBjb25uZWN0b3IgZ3JvdXAgKyB0aGUgdHdvIG5vZGVzIGl0IGNvbm5lY3RzLgogIGZ1bmN0aW9uIGFjdGl2YXRlQ29ubmVjdG9yKGNvbnRhaW5lciwgZ3JvdXApIHsKICAgIGdyb3VwLmNsYXNzTGlzdC5hZGQoJ2lzLWFjdGl2ZScpOwogICAgdmFyIHNyY0lkID0gZ3JvdXAuZ2V0QXR0cmlidXRlKCdkYXRhLXNvdXJjZS1pZCcpOwogICAgdmFyIHRndElkID0gZ3JvdXAuZ2V0QXR0cmlidXRlKCdkYXRhLXRhcmdldC1pZCcpOwogICAgaWYgKHNyY0lkKSB7CiAgICAgIHZhciBzID0gY29udGFpbmVyLnF1ZXJ5U2VsZWN0b3IoJ1tkYXRhLW5vZGUtaWQ9IicgKyBjc3NFc2Moc3JjSWQpICsgJyJdJyk7CiAgICAgIGlmIChzKSBzLmNsYXNzTGlzdC5hZGQoJ2lzLWFjdGl2ZScpOwogICAgfQogICAgaWYgKHRndElkKSB7CiAgICAgIHZhciB0ID0gY29udGFpbmVyLnF1ZXJ5U2VsZWN0b3IoJ1tkYXRhLW5vZGUtaWQ9IicgKyBjc3NFc2ModGd0SWQpICsgJyJdJyk7CiAgICAgIGlmICh0KSB0LmNsYXNzTGlzdC5hZGQoJ2lzLWFjdGl2ZScpOwogICAgfQogIH0KCiAgZnVuY3Rpb24gZGVhY3RpdmF0ZUNvbm5lY3Rvcihjb250YWluZXIsIGdyb3VwKSB7CiAgICBncm91cC5jbGFzc0xpc3QucmVtb3ZlKCdpcy1hY3RpdmUnKTsKICAgIHZhciBzcmNJZCA9IGdyb3VwLmdldEF0dHJpYnV0ZSgnZGF0YS1zb3VyY2UtaWQnKTsKICAgIHZhciB0Z3RJZCA9IGdyb3VwLmdldEF0dHJpYnV0ZSgnZGF0YS10YXJnZXQtaWQnKTsKICAgIGlmIChzcmNJZCkgewogICAgICB2YXIgcyA9IGNvbnRhaW5lci5xdWVyeVNlbGVjdG9yKCdbZGF0YS1ub2RlLWlkPSInICsgY3NzRXNjKHNyY0lkKSArICciXScpOwogICAgICBpZiAocykgcy5jbGFzc0xpc3QucmVtb3ZlKCdpcy1hY3RpdmUnKTsKICAgIH0KICAgIGlmICh0Z3RJZCkgewogICAgICB2YXIgdCA9IGNvbnRhaW5lci5xdWVyeVNlbGVjdG9yKCdbZGF0YS1ub2RlLWlkPSInICsgY3NzRXNjKHRndElkKSArICciXScpOwogICAgICBpZiAodCkgdC5jbGFzc0xpc3QucmVtb3ZlKCdpcy1hY3RpdmUnKTsKICAgIH0KICB9CgogIC8vIE1pbmltYWwgQ1NTIGF0dHJpYnV0ZS1zZWxlY3RvciBlc2NhcGluZyBmb3IgaWRzIHdpdGggcXVvdGVzL2JhY2tzbGFzaGVzLgogIGZ1bmN0aW9uIGNzc0VzYyh2KSB7CiAgICByZXR1cm4gU3RyaW5nKHYpLnJlcGxhY2UoLyhbIlxcXSkvZywgJ1xcJDEnKTsKICB9CgogIC8vIEF0dGFjaCBhbGwgaG92ZXIgd2lyaW5nLiBSZXR1cm5zIGEgZGV0YWNoKCkgZnVuY3Rpb24gdGhhdCByZW1vdmVzIGV2ZXJ5CiAgLy8gbGlzdGVuZXIgYWRkZWQgYnkgdGhpcyBjYWxsIOKAlCBjYWxsIGl0IGJlZm9yZSByZS1yZW5kZXJpbmcsIHRoZW4gcmUtYXR0YWNoLgogIGZ1bmN0aW9uIGF0dGFjaERpYWdyYW1JbnRlcmFjdGl2aXR5KGNvbnRhaW5lciwgc3ZnKSB7CiAgICBpZiAoIWNvbnRhaW5lciB8fCAhc3ZnKSB0aHJvdyBuZXcgRXJyb3IoJ2F0dGFjaERpYWdyYW1JbnRlcmFjdGl2aXR5OiBjb250YWluZXIgYW5kIHN2ZyBhcmUgcmVxdWlyZWQnKTsKICAgIHZhciBib3VuZCA9IFtdOwogICAgZnVuY3Rpb24gb24oZWwsIHR5cGUsIGZuKSB7IGVsLmFkZEV2ZW50TGlzdGVuZXIodHlwZSwgZm4pOyBib3VuZC5wdXNoKFtlbCwgdHlwZSwgZm5dKTsgfQoKICAgIC8vIENvbm5lY3RvciBob3ZlciAtPiBoaWdobGlnaHQgdGhhdCBjb25uZWN0b3IgKyBpdHMgZW5kcG9pbnRzLgogICAgc3ZnLnF1ZXJ5U2VsZWN0b3JBbGwoJy5jb25uZWN0b3ItZ3JvdXAnKS5mb3JFYWNoKGZ1bmN0aW9uIChncm91cCkgewogICAgICBvbihncm91cCwgJ21vdXNlZW50ZXInLCBmdW5jdGlvbiAoKSB7IGFjdGl2YXRlQ29ubmVjdG9yKGNvbnRhaW5lciwgZ3JvdXApOyB9KTsKICAgICAgb24oZ3JvdXAsICdtb3VzZWxlYXZlJywgZnVuY3Rpb24gKCkgeyBkZWFjdGl2YXRlQ29ubmVjdG9yKGNvbnRhaW5lciwgZ3JvdXApOyB9KTsKICAgIH0pOwoKICAgIC8vIE5vZGUgaG92ZXIgLT4gbWFyayBpdCBwcmltYXJ5ICsgaGlnaGxpZ2h0IGV2ZXJ5IGNvbm5lY3RvciBpbmNpZGVudCB0bwogICAgLy8gaXQgKGFuZCB0aGVyZWZvcmUgZWFjaCBjb25uZWN0b3IncyBvdGhlciBlbmRwb2ludCB0b28pLgogICAgY29udGFpbmVyLnF1ZXJ5U2VsZWN0b3JBbGwoJy5mbG93LW5vZGVbZGF0YS1ub2RlLWlkXScpLmZvckVhY2goZnVuY3Rpb24gKG5vZGVFbCkgewogICAgICB2YXIgbm9kZUlkID0gbm9kZUVsLmdldEF0dHJpYnV0ZSgnZGF0YS1ub2RlLWlkJyk7CiAgICAgIGlmICghbm9kZUlkKSByZXR1cm47CiAgICAgIHZhciBzZWwgPQogICAgICAgICcuY29ubmVjdG9yLWdyb3VwW2RhdGEtc291cmNlLWlkPSInICsgY3NzRXNjKG5vZGVJZCkgKyAnIl0sICcgKwogICAgICAgICcuY29ubmVjdG9yLWdyb3VwW2RhdGEtdGFyZ2V0LWlkPSInICsgY3NzRXNjKG5vZGVJZCkgKyAnIl0nOwogICAgICBvbihub2RlRWwsICdtb3VzZWVudGVyJywgZnVuY3Rpb24gKCkgewogICAgICAgIG5vZGVFbC5jbGFzc0xpc3QuYWRkKCdpcy1wcmltYXJ5Jyk7CiAgICAgICAgc3ZnLnF1ZXJ5U2VsZWN0b3JBbGwoc2VsKS5mb3JFYWNoKGZ1bmN0aW9uIChnKSB7IGFjdGl2YXRlQ29ubmVjdG9yKGNvbnRhaW5lciwgZyk7IH0pOwogICAgICB9KTsKICAgICAgb24obm9kZUVsLCAnbW91c2VsZWF2ZScsIGZ1bmN0aW9uICgpIHsKICAgICAgICBub2RlRWwuY2xhc3NMaXN0LnJlbW92ZSgnaXMtcHJpbWFyeScpOwogICAgICAgIHN2Zy5xdWVyeVNlbGVjdG9yQWxsKHNlbCkuZm9yRWFjaChmdW5jdGlvbiAoZykgeyBkZWFjdGl2YXRlQ29ubmVjdG9yKGNvbnRhaW5lciwgZyk7IH0pOwogICAgICB9KTsKICAgIH0pOwoKICAgIHJldHVybiBmdW5jdGlvbiBkZXRhY2goKSB7CiAgICAgIGJvdW5kLmZvckVhY2goZnVuY3Rpb24gKGIpIHsgYlswXS5yZW1vdmVFdmVudExpc3RlbmVyKGJbMV0sIGJbMl0pOyB9KTsKICAgICAgYm91bmQgPSBbXTsKICAgIH07CiAgfQoKICB2YXIgYXBpID0geyBhdHRhY2g6IGF0dGFjaERpYWdyYW1JbnRlcmFjdGl2aXR5LCBkZXRhY2g6IG51bGwsIGF1dG9BdHRhY2g6IGF1dG9BdHRhY2ggfTsKCiAgLy8gYXV0b0F0dGFjaCgpIOKAlCBmb3IgZ2VuZXJhdGVkL3N0YW5kYWxvbmUgSFRNTCB3aGVyZSB5b3UgZG9uJ3Qgd2FudCB0bwogIC8vIGhhbmQtd3JpdGUgdGhlIGF0dGFjaCBjYWxsLiBGaW5kcyB0aGUgY29ubmVjdG9ycyA8c3ZnPiAodGhlIG9uZSBob2xkaW5nCiAgLy8gLmNvbm5lY3Rvci1ncm91cCBlbGVtZW50cykgYW5kIGEgY29udGFpbmVyIHRoYXQgaG9sZHMgLmZsb3ctbm9kZSBjYXJkcywKICAvLyB0aGVuIGF0dGFjaGVzLiBSZXR1cm5zIGRldGFjaCgpIG9yIG51bGwgaWYgbm8gZGlhZ3JhbSB3YXMgZm91bmQuCiAgLy8gSG9ub3JzIGFuIGV4cGxpY2l0IG92ZXJyaWRlIHZpYSBbZGF0YS1kaWFncmFtLXJvb3RdIC8gW2RhdGEtY29ubmVjdG9ycy1zdmddLgogIGZ1bmN0aW9uIGF1dG9BdHRhY2goZG9jKSB7CiAgICBkb2MgPSBkb2MgfHwgKHR5cGVvZiBkb2N1bWVudCAhPT0gJ3VuZGVmaW5lZCcgPyBkb2N1bWVudCA6IG51bGwpOwogICAgaWYgKCFkb2MpIHJldHVybiBudWxsOwogICAgdmFyIHN2ZyA9IGRvYy5xdWVyeVNlbGVjdG9yKCdbZGF0YS1jb25uZWN0b3JzLXN2Z10nKSB8fAogICAgICBBcnJheS5wcm90b3R5cGUuZmluZC5jYWxsKGRvYy5xdWVyeVNlbGVjdG9yQWxsKCdzdmcnKSwgZnVuY3Rpb24gKHMpIHsKICAgICAgICByZXR1cm4gcy5xdWVyeVNlbGVjdG9yKCcuY29ubmVjdG9yLWdyb3VwJyk7CiAgICAgIH0pOwogICAgaWYgKCFzdmcpIHJldHVybiBudWxsOwogICAgdmFyIGNvbnRhaW5lciA9IGRvYy5xdWVyeVNlbGVjdG9yKCdbZGF0YS1kaWFncmFtLXJvb3RdJyk7CiAgICBpZiAoIWNvbnRhaW5lcikgewogICAgICAvLyBuZWFyZXN0IGFuY2VzdG9yIG9mIHRoZSBzdmcgdGhhdCBhbHNvIGNvbnRhaW5zIC5mbG93LW5vZGUgY2FyZHMKICAgICAgdmFyIGVsID0gc3ZnLnBhcmVudEVsZW1lbnQ7CiAgICAgIHdoaWxlIChlbCAmJiAhZWwucXVlcnlTZWxlY3RvcignLmZsb3ctbm9kZVtkYXRhLW5vZGUtaWRdJykpIGVsID0gZWwucGFyZW50RWxlbWVudDsKICAgICAgY29udGFpbmVyID0gZWwgfHwgZG9jLmJvZHk7CiAgICB9CiAgICByZXR1cm4gYXR0YWNoRGlhZ3JhbUludGVyYWN0aXZpdHkoY29udGFpbmVyLCBzdmcpOwogIH0KCiAgZnVuY3Rpb24gYXV0b0F0dGFjaE9uUmVhZHkoKSB7CiAgICBpZiAodHlwZW9mIGRvY3VtZW50ID09PSAndW5kZWZpbmVkJykgcmV0dXJuOwogICAgaWYgKGRvY3VtZW50LnJlYWR5U3RhdGUgPT09ICdsb2FkaW5nJykgewogICAgICBkb2N1bWVudC5hZGRFdmVudExpc3RlbmVyKCdET01Db250ZW50TG9hZGVkJywgZnVuY3Rpb24gKCkgeyBhdXRvQXR0YWNoKGRvY3VtZW50KTsgfSk7CiAgICB9IGVsc2UgewogICAgICBhdXRvQXR0YWNoKGRvY3VtZW50KTsKICAgIH0KICB9CiAgYXBpLmF1dG9BdHRhY2hPblJlYWR5ID0gYXV0b0F0dGFjaE9uUmVhZHk7CgogIGlmICh0eXBlb2YgbW9kdWxlICE9PSAndW5kZWZpbmVkJyAmJiBtb2R1bGUuZXhwb3J0cykgbW9kdWxlLmV4cG9ydHMgPSBhcGk7CiAgaWYgKHJvb3QpIHsKICAgIHJvb3QuU25vd0dyYW1JbnRlcmFjdGl2aXR5ID0gYXBpOwogICAgcm9vdC5hdHRhY2hEaWFncmFtSW50ZXJhY3Rpdml0eSA9IGF0dGFjaERpYWdyYW1JbnRlcmFjdGl2aXR5OwogIH0KfSkodHlwZW9mIHdpbmRvdyAhPT0gJ3VuZGVmaW5lZCcgPyB3aW5kb3cgOiB0aGlzKTsK').decode('utf-8').replace('</script','<\\\\/script')
_LOGO_DATA_URI = 'data:image/svg+xml;base64,' + 'PHN2ZyBpZD0iTGF5ZXJfMSIgZGF0YS1uYW1lPSJMYXllciAxIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2MTAuMDQgMTM5LjA4Ij48ZGVmcz48c3R5bGU+LmNscy0xe2ZpbGw6IzI5YjVlODtmaWxsLXJ1bGU6ZXZlbm9kZDt9PC9zdHlsZT48L2RlZnM+PHBhdGggY2xhc3M9ImNscy0xIiBkPSJNNjAxLjgxLDQxLjA3SDYwMC4ydjJoMS42MWMuNzQsMCwxLjIzLS4zMywxLjIzLTFTNjAyLjU5LDQxLjA3LDYwMS44MSw0MS4wN1ptLTMuNTktMS44M2gzLjYyYzIsMCwzLjMsMS4wOCwzLjMsMi43NmEyLjY0LDIuNjQsMCwwLDEtMS4zMSwyLjMybDEuNDIsMi4wNnYuNDFoLTIuMDZsLTEuMzgtMkg2MDAuMnYyaC0yWm0xMC4xMywzLjkyYzAtNC0yLjY5LTcuMS02LjgxLTcuMXMtNi43MywyLjkxLTYuNzMsNy4xYzAsNCwyLjY5LDcuMTEsNi43Myw3LjExUzYwOC4zNSw0Ny4yLDYwOC4zNSw0My4xNlptMS42OSwwYzAsNC43Ni0zLjE4LDguNzItOC41LDguNzJzLTguNDEtNC04LjQxLTguNzIsMy4xNC04LjcxLDguNDEtOC43MVM2MTAsMzguNDEsNjEwLDQzLjE2Wk0xMzQuMTEsNjAuMDdsLTE2LjM5LDkuNDhMMTM0LjExLDc5YTguNjQsOC42NCwwLDEsMS04LjY0LDE1TDk2LjEyLDc3YTguNTgsOC41OCwwLDAsMS0zLjkyLTQuOTMsOC40NCw4LjQ0LDAsMCwxLS4zOC0yLjgxLDgsOCwwLDAsMSwuMy0yLDguNjcsOC42NywwLDAsMSw0LTUuMThsMjkuMzUtMTYuOTRhOC42NCw4LjY0LDAsMCwxLDguNjQsMTVaTTExOC41OSwxMDYsODkuMjUsODkuMDhhOC40OSw4LjQ5LDAsMCwwLTUtMS4xMyw4LjYzLDguNjMsMCwwLDAtOCw4LjYxdjMzLjg4YTguNjQsOC42NCwwLDAsMCwxNy4yOCwwdi0xOUwxMTAsMTIxYTguNjQsOC42NCwwLDEsMCw4LjYzLTE1Wk04NC43Myw3Mi44Niw3Mi41Myw4NWEyLjM5LDIuMzksMCwwLDEtMS41My42NUg2Ny40MkEyLjQ4LDIuNDgsMCwwLDEsNjUuODgsODVMNTMuNjksNzIuODZhMi40OSwyLjQ5LDAsMCwxLS42My0xLjUyVjY3Ljc1YTIuNSwyLjUsMCwwLDEsLjYzLTEuNTRMNjUuODgsNTRhMi40NywyLjQ3LDAsMCwxLDEuNTQtLjY0SDcxYTIuNCwyLjQsMCwwLDEsMS41My42NGwxMi4yLDEyLjE4YTIuNSwyLjUsMCwwLDEsLjYzLDEuNTR2My41OUEyLjQ5LDIuNDksMCwwLDEsODQuNzMsNzIuODZaTTc1LDY5LjQ4YTIuNjQsMi42NCwwLDAsMC0uNjQtMS41NUw3MC44LDY0LjQyYTIuNDUsMi40NSwwLDAsMC0xLjUyLS42NGgtLjE0YTIuNDUsMi40NSwwLDAsMC0xLjUyLjY0bC0zLjUzLDMuNTFhMi41MSwyLjUxLDAsMCwwLS42MywxLjU1di4xM2EyLjQxLDIuNDEsMCwwLDAsLjYzLDEuNTJsMy41MywzLjUzYTIuNDgsMi40OCwwLDAsMCwxLjUyLjY0aC4xNGEyLjQ1LDIuNDUsMCwwLDAsMS41Mi0uNjRsMy41NC0zLjUzQTIuNTMsMi41MywwLDAsMCw3NSw2OS42MVpNMTkuODMsMzMuMDYsNDkuMTgsNTBhOC42Nyw4LjY3LDAsMCwwLDEzLTcuNDlWOC42M2E4LjY0LDguNjQsMCwwLDAtMTcuMjgsMHYxOUwyOC40NiwxOC4xYTguNjQsOC42NCwwLDEsMC04LjYzLDE1Wk04NC4yNSw1MS4xM2E4LjU3LDguNTcsMCwwLDAsNS0xLjEzbDI5LjM0LTE2Ljk0YTguNjQsOC42NCwwLDEsMC04LjYzLTE1TDkzLjUzLDI3LjU5di0xOWE4LjY0LDguNjQsMCwwLDAtMTcuMjgsMFY0Mi41MUE4LjY0LDguNjQsMCwwLDAsODQuMjUsNTEuMTNaTTU0LjE5LDg4YTguNDksOC40OSwwLDAsMC01LDEuMTNMMTkuODMsMTA2YTguNjQsOC42NCwwLDEsMCw4LjYzLDE1bDE2LjQ0LTkuNDh2MTlhOC42NCw4LjY0LDAsMSwwLDE3LjI4LDBWOTYuNTZBOC42Myw4LjYzLDAsMCwwLDU0LjE5LDg4Wm0tOC0xNS44N2E4LjQ1LDguNDUsMCwwLDAsLjM5LTIuODEsOSw5LDAsMCwwLS4zMS0yLDguNTYsOC41NiwwLDAsMC00LTUuMThMMTMsNDUuMTFhOC42NCw4LjY0LDAsMCwwLTguNjQsMTVsMTYuMzksOS40OEw0LjMyLDc5QTguNjQsOC42NCwwLDAsMCwxMyw5NEw0Mi4yOSw3N0E4LjU0LDguNTQsMCwwLDAsNDYuMjMsNzIuMDhabTM2NC01MC42M2gtMS40M2ExOC45LDE4LjksMCwwLDAtNiwuODYsMTAuOTIsMTAuOTIsMCwwLDAtNC45MiwzLjJoMEExMywxMywwLDAsMCwzOTUuMDcsMzFhMjksMjksMCwwLDAtLjgsNy4xMnY1LjE4aC01LjcxQTMuNTUsMy41NSwwLDAsMCwzODUsNDYuNzdhMy44NCwzLjg0LDAsMCwwLDEsMi42NywzLjkyLDMuOTIsMCwwLDAsMi41NiwxLjE3aDUuNjdWOTIuODVhMy41OSwzLjU5LDAsMCwwLDEuMDgsMi41NSwzLjc4LDMuNzgsMCwwLDAsMi42MSwxLDMuNTYsMy41NiwwLDAsMCwzLjUxLTMuNThWNTAuNjFoNi4xNGEzLjg3LDMuODcsMCwwLDAsMi41NS0xLjE0LDMuNzIsMy43MiwwLDAsMCwxLjA4LTIuNjNWNDYuN2EzLjU1LDMuNTUsMCwwLDAtMy41OS0zLjQ1aC02LjE4VjM4LjA5YTIxLjE0LDIxLjE0LDAsMCwxLC42Mi01LjIzLDYuMzMsNi4zMywwLDAsMSwxLjE5LTIuNTJBNC4wOSw0LjA5LDAsMCwxLDQwNSwyOS4yNmExMS44NCwxMS44NCwwLDAsMSwzLjYyLS40NWguMTlsLjI4LDAsLjMzLDBoLjgxYTMuNjgsMy42OCwwLDEsMCwwLTcuMzZabTEyNi42LDI3LjMzYTMuNjgsMy42OCwwLDAsMCwxLjExLTIuNiwzLjQyLDMuNDIsMCwwLDAtMS4xMi0yLjUxaDBsMCwwLDAsMGgwYTMuNSwzLjUsMCwwLDAtNS4wNiwwTDUwMy40OSw3MS4xOVYyNC45YTMuNjcsMy42NywwLDAsMC0zLjcyLTMuNjIsMy42LDMuNiwwLDAsMC0yLjU0LDEuMDcsMy42NywzLjY3LDAsMCwwLTEuMDcsMi41NVY5Mi42NmEzLjY1LDMuNjUsMCwwLDAsMy42MSwzLjYxLDMuNjcsMy42NywwLDAsMCwzLjcyLTMuNjFWODEuNDhsOS4yMS05LjE5LDE4Ljc2LDIyLjYzYTIuOTEsMi45MSwwLDAsMCwxLjMsMS4wNyw0LjUsNC41LDAsMCwwLDEuNTQuMjgsMy43OSwzLjc5LDAsMCwwLDIuMzYtLjc3bC4wNSwwLDAsMGEzLjgxLDMuODEsMCwwLDAsMS4xOC0yLjczLDMuNzYsMy43NiwwLDAsMC0uODktMi40aDBsLTE5LjEtMjMuMjEsMTguOS0xOC4yOVptLTUxLTQuNjZhMy42MSwzLjYxLDAsMCwxLDEuMDgsMi41OVY5Mi42NmEzLjY0LDMuNjQsMCwwLDEtMy42MSwzLjYxLDMuNjcsMy42NywwLDAsMS0yLjU1LTEuMDcsMy41OCwzLjU4LDAsMCwxLTEuMDctMi41NFY4OC4xOGEyNC4xOSwyNC4xOSwwLDAsMS0zNS45MS4yMiwyNy41MywyNy41MywwLDAsMSwwLTM3LjQzLDI0LjMzLDI0LjMzLDAsMCwxLDM1LjkxLjEyVjQ2LjcxYTMuNjIsMy42MiwwLDAsMSwxLjA5LTIuNTksMy43LDMuNywwLDAsMSw1LjA2LDBabS02LjE1LDI1LjU3YTIwLjIsMjAuMiwwLDAsMC01LjMzLTEzLjgyLDE3LDE3LDAsMCwwLTI1LjMzLDAsMjAuMjIsMjAuMjIsMCwwLDAtNS4zNiwxMy44MkEyMCwyMCwwLDAsMCw0NDksODMuNDRhMTcuMTgsMTcuMTgsMCwwLDAsMjUuMzUsMEEyMC4wNywyMC4wNywwLDAsMCw0NzkuNjgsNjkuNjlaTTE4OC44LDY4LjRhODcuMjcsODcuMjcsMCwwLDAtOS41My0zLjQ5LDY1LjE1LDY1LjE1LDAsMCwxLTguMzMtMyw4LjA5LDguMDksMCwwLDEtMi41Mi0xLjkyLDMuNTcsMy41NywwLDAsMS0uODYtMi4zOSw1LjcyLDUuNzIsMCwwLDEsMS0zLjM1QTkuNzgsOS43OCwwLDAsMSwxNzMuMDYsNTFhMTQuNjQsMTQuNjQsMCwwLDEsNS4xMi0xLjA2LDE0LjE1LDE0LjE1LDAsMCwxLDguNjgsMi43OWMxLC43MSwxLjgyLDEuNDQsMi42LDJhNi4yNSw2LjI1LDAsMCwwLDEuMjIuOCwzLjE2LDMuMTYsMCwwLDAsMS40My4zOCwyLjU2LDIuNTYsMCwwLDAsMS0uMiwzLjEsMy4xLDAsMCwwLC44OC0uNTUsMywzLDAsMCwwLC42NS0uODgsMi41OCwyLjU4LDAsMCwwLC4yMS0xLDMuODEsMy44MSwwLDAsMC0uNS0xLjgxLDExLDExLDAsMCwwLTIuNDUtMi45LDI0LjQxLDI0LjQxLDAsMCwwLTYtMy43OCwxNy42NiwxNy42NiwwLDAsMC03LTEuNzFjLTUuMzcsMC05Ljg1LDEuMjItMTMuMTEsMy40NmExMy43NywxMy43NywwLDAsMC00LjI0LDQuMjIsMTMuNTksMTMuNTksMCwwLDAtMS43NSw2Ljgxdi4zOGExMC44MywxMC44MywwLDAsMCwyLjI3LDYuODNjMi4xMywyLjY4LDUuMjgsNC4yOSw4LjM3LDUuNDNzNi4xNiwxLjgyLDguMTEsMi40N2EzOS4yNSwzOS4yNSwwLDAsMSw3Ljc4LDMuMjFBOS4xNyw5LjE3LDAsMCwxLDE4OC44Myw3OGE0LjcxLDQuNzEsMCwwLDEsLjksMi43MXYuMDhhNi4yNyw2LjI3LDAsMCwxLTEuMjEsMy43OCwxMC42MiwxMC42MiwwLDAsMS01LDMuMzcsMTcuMzksMTcuMzksMCwwLDEtNS4zNywxLDIxLjU2LDIxLjU2LDAsMCwxLTEwLjA5LTIuMjZjLTEuMTQtLjU3LTIuMDYtMS4xMy0yLjktMS42MS0uNDEtLjIyLS44LS40My0xLjIxLS42YTMuNDMsMy40MywwLDAsMC0xLjMtLjI3LDIuNDgsMi40OCwwLDAsMC0uOTEuMTcsMi4zNiwyLjM2LDAsMCwwLS43OS41MiwzLjY3LDMuNjcsMCwwLDAtLjc5LDEsMi43NywyLjc3LDAsMCwwLS4yOCwxLjIzLDMuNTQsMy41NCwwLDAsMCwuNjQsMS45NCw5Ljg5LDkuODksMCwwLDAsMi41NCwyLjM2LDMxLjMxLDMxLjMxLDAsMCwwLDQsMi4yMSwyOC45LDI4LjksMCwwLDAsMTEuMDksMi41aDBjNS4xNSwwLDkuNjEtMS4xOSwxMy4zNi00aDBhMTQuMzcsMTQuMzcsMCwwLDAsNS45NS0xMS41MSwxMi42LDEyLjYsMCwwLDAtMS42NC02LjQ4QTE1LjUzLDE1LjUzLDAsMCwwLDE4OC44LDY4LjRaTTQyNS4xNywyMS4yOGEzLjYyLDMuNjIsMCwwLDAtMi41NCwxLjA3LDMuNTgsMy41OCwwLDAsMC0xLjA3LDIuNTVWOTIuNjZhMy41NCwzLjU0LDAsMCwwLDEuMDcsMi41NCwzLjY3LDMuNjcsMCwwLDAsNi4yNi0yLjU0VjI0LjlBMy42NywzLjY3LDAsMCwwLDQyNS4xNywyMS4yOFpNNTkxLjU2LDY4di4zNmEzLjMxLDMuMzEsMCwwLDEtMS4xMywyLjQ5LDMuNzgsMy43OCwwLDAsMS0yLjUuOTJINTQ3LjM3YzEsOS45LDguOTMsMTcuMiwxOC4zNywxNy4yOGgyLjM5QTE1LjkzLDE1LjkzLDAsMCwwLDU3Nyw4Ni4xOGEyMiwyMiwwLDAsMCw2LjYzLTcsMy4zMSwzLjMxLDAsMCwxLDEuMzQtMS4yOSwzLjQzLDMuNDMsMCwwLDEsMS42OS0uNDMsMy42MywzLjYzLDAsMCwxLDEuODQuNWwwLDAsMCwwYTMuOTEsMy45MSwwLDAsMSwxLjY1LDMuMTQsMy42NiwzLjY2LDAsMCwxLS41MSwxLjg3djBoMGEzMC40NSwzMC40NSwwLDAsMS05LDkuMjcsMjMsMjMsMCwwLDEtMTIuNTEsMy45MUg1NjUuN2EyNS40NiwyNS40NiwwLDAsMS0xOC4xOS03Ljg3QTI2LjcxLDI2LjcxLDAsMCwxLDU0MCw2OS43OWEyNy4wOSwyNy4wOSwwLDAsMSw3LjU0LTE4Ljg2LDI1LjM5LDI1LjM5LDAsMCwxLDE4LjMzLTcuODEsMjUsMjUsMCwwLDEsMTcuNTcsNy4xOCwyNy40OCwyNy40OCwwLDAsMSw4LjA3LDE3LjYzWm0tNy45Mi0zLjQyQTE4LjQ2LDE4LjQ2LDAsMCwwLDU2NS45LDUwLjNhMTguNjcsMTguNjcsMCwwLDAtMTgsMTQuMjZaTTIyNy4zNCw0My4yMWEyMS43NywyMS43NywwLDAsMC0xNC42OCw1LjczVjQ2LjgzYTMuNywzLjcsMCwwLDAtMS0yLjUzLDMuNDgsMy40OCwwLDAsMC0yLjUxLTEuMDksMy41NywzLjU3LDAsMCwwLTMuNjIsMy42MlY5My43NGwuMTUuMTV2MGExLjg1LDEuODUsMCwwLDAsLjI0LjQ5LDMuODksMy44OSwwLDAsMCwyLjMsMS44MmwuMTUsMGguNzhhMy42OCwzLjY4LDAsMCwwLDEuNTQtLjM1QTMuMTQsMy4xNCwwLDAsMCwyMTEuOCw5NWgwcy4wNS0uMDkuMS0uMTMsMCwwLDAsMGEzLjI2LDMuMjYsMCwwLDAsLjQ1LS43NCw1LjM1LDUuMzUsMCwwLDAsLjIyLS43NWwwLS4xM1Y2NWExNSwxNSwwLDAsMSw0LjQyLTEwLjMyQTE0LjU1LDE0LjU1LDAsMCwxLDI0MS45Miw2NVY5Mi42NmEzLjYzLDMuNjMsMCwwLDAsNi4xNSwyLjU5LDMuNTksMy41OSwwLDAsMCwxLjA4LTIuNTlWNjVBMjEuODcsMjEuODcsMCwwLDAsMjI3LjM0LDQzLjIxWk0yOTkuMjIsNTFhMjcuNDMsMjcuNDMsMCwwLDEsMCwzNy4zNywyNC4xOCwyNC4xOCwwLDAsMS0zNS43NiwwLDI3LjM0LDI3LjM0LDAsMCwxLDAtMzcuMzcsMjQuMjMsMjQuMjMsMCwwLDEsMzUuNzYsMFptLjEsMTguNjlBMjAuMTcsMjAuMTcsMCwwLDAsMjk0LDU1LjkxYTE2LjkzLDE2LjkzLDAsMCwwLTI1LjMsMCwyMC4xNywyMC4xNywwLDAsMC01LjM2LDEzLjc4LDIwLDIwLDAsMCwwLDUuMzYsMTMuNzEsMTcsMTcsMCwwLDAsMjUuMywwQTIwLDIwLDAsMCwwLDI5OS4zMiw2OS42OVptNzgtMjYuMTdoMGEzLjI5LDMuMjksMCwwLDAtMS4zLS4yNywzLjcyLDMuNzIsMCwwLDAtMy4zOSwyLjIydjBsLTEzLjgsMzcuNzhMMzQ4LjE5LDU3LjkyaDBhMy42MywzLjYzLDAsMCwwLTEuNDQtMS42MywzLjkzLDMuOTMsMCwwLDAtMi4wNy0uNTksMy43OSwzLjc5LDAsMCwwLTMuNDEsMi4yMmgwTDMzMC41OCw4My4yNywzMTYuNyw0NS41aDBhMy4xOSwzLjE5LDAsMCwwLTEuMzItMS42OCwzLjcyLDMuNzIsMCwwLDAtMi0uNTksMy41OCwzLjU4LDAsMCwwLTEuMzYuMjdoMGwwLDBhMy42MiwzLjYyLDAsMCwwLTEuODMsNC42M2gwTDMyNy4yLDk0djBhMy41OCwzLjU4LDAsMCwwLC42LDEsMywzLDAsMCwwLC43OS42LDIuMjIsMi4yMiwwLDAsMCwuMjguMjEsMS42MywxLjYzLDAsMCwwLC41MS4xOSwzLjc5LDMuNzksMCwwLDAsMS4yNS4yNCwzLjU0LDMuNTQsMCwwLDAsMS45MS0uNjEsMy4zNCwzLjM0LDAsMCwwLDEuMjgtMS41OWwuMDUsMCwxMC43OS0yNS44LDEwLjgxLDI1LjdoMGEzLjUxLDMuNTEsMCwwLDAsMS4yLDEuNiwzLjgsMy44LDAsMCwwLDEuNzcuNzRoLjQ1YTMuMywzLjMsMCwwLDAsMS4yMS0uMjIsNCw0LDAsMCwwLC45Mi0uNTEsNC4yNyw0LjI3LDAsMCwwLDEuMy0xLjczdjBsMTctNDUuNjNhMy41NywzLjU3LDAsMCwwLTEuOTMtNC42M1oiLz48L3N2Zz4='
_LOGO_WHITE_URI = 'data:image/svg+xml;base64,' + 'PHN2ZyBpZD0iTGF5ZXJfMSIgZGF0YS1uYW1lPSJMYXllciAxIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2MTAuMDQgMTM5LjA4Ij48ZGVmcz48c3R5bGU+LmNscy0xe2ZpbGw6I2ZmZmZmZjtmaWxsLXJ1bGU6ZXZlbm9kZDt9PC9zdHlsZT48L2RlZnM+PHBhdGggY2xhc3M9ImNscy0xIiBkPSJNNjAxLjgxLDQxLjA3SDYwMC4ydjJoMS42MWMuNzQsMCwxLjIzLS4zMywxLjIzLTFTNjAyLjU5LDQxLjA3LDYwMS44MSw0MS4wN1ptLTMuNTktMS44M2gzLjYyYzIsMCwzLjMsMS4wOCwzLjMsMi43NmEyLjY0LDIuNjQsMCwwLDEtMS4zMSwyLjMybDEuNDIsMi4wNnYuNDFoLTIuMDZsLTEuMzgtMkg2MDAuMnYyaC0yWm0xMC4xMywzLjkyYzAtNC0yLjY5LTcuMS02LjgxLTcuMXMtNi43MywyLjkxLTYuNzMsNy4xYzAsNCwyLjY5LDcuMTEsNi43Myw3LjExUzYwOC4zNSw0Ny4yLDYwOC4zNSw0My4xNlptMS42OSwwYzAsNC43Ni0zLjE4LDguNzItOC41LDguNzJzLTguNDEtNC04LjQxLTguNzIsMy4xNC04LjcxLDguNDEtOC43MVM2MTAsMzguNDEsNjEwLDQzLjE2Wk0xMzQuMTEsNjAuMDdsLTE2LjM5LDkuNDhMMTM0LjExLDc5YTguNjQsOC42NCwwLDEsMS04LjY0LDE1TDk2LjEyLDc3YTguNTgsOC41OCwwLDAsMS0zLjkyLTQuOTMsOC40NCw4LjQ0LDAsMCwxLS4zOC0yLjgxLDgsOCwwLDAsMSwuMy0yLDguNjcsOC42NywwLDAsMSw0LTUuMThsMjkuMzUtMTYuOTRhOC42NCw4LjY0LDAsMCwxLDguNjQsMTVaTTExOC41OSwxMDYsODkuMjUsODkuMDhhOC40OSw4LjQ5LDAsMCwwLTUtMS4xMyw4LjYzLDguNjMsMCwwLDAtOCw4LjYxdjMzLjg4YTguNjQsOC42NCwwLDAsMCwxNy4yOCwwdi0xOUwxMTAsMTIxYTguNjQsOC42NCwwLDEsMCw4LjYzLTE1Wk04NC43Myw3Mi44Niw3Mi41Myw4NWEyLjM5LDIuMzksMCwwLDEtMS41My42NUg2Ny40MkEyLjQ4LDIuNDgsMCwwLDEsNjUuODgsODVMNTMuNjksNzIuODZhMi40OSwyLjQ5LDAsMCwxLS42My0xLjUyVjY3Ljc1YTIuNSwyLjUsMCwwLDEsLjYzLTEuNTRMNjUuODgsNTRhMi40NywyLjQ3LDAsMCwxLDEuNTQtLjY0SDcxYTIuNCwyLjQsMCwwLDEsMS41My42NGwxMi4yLDEyLjE4YTIuNSwyLjUsMCwwLDEsLjYzLDEuNTR2My41OUEyLjQ5LDIuNDksMCwwLDEsODQuNzMsNzIuODZaTTc1LDY5LjQ4YTIuNjQsMi42NCwwLDAsMC0uNjQtMS41NUw3MC44LDY0LjQyYTIuNDUsMi40NSwwLDAsMC0xLjUyLS42NGgtLjE0YTIuNDUsMi40NSwwLDAsMC0xLjUyLjY0bC0zLjUzLDMuNTFhMi41MSwyLjUxLDAsMCwwLS42MywxLjU1di4xM2EyLjQxLDIuNDEsMCwwLDAsLjYzLDEuNTJsMy41MywzLjUzYTIuNDgsMi40OCwwLDAsMCwxLjUyLjY0aC4xNGEyLjQ1LDIuNDUsMCwwLDAsMS41Mi0uNjRsMy41NC0zLjUzQTIuNTMsMi41MywwLDAsMCw3NSw2OS42MVpNMTkuODMsMzMuMDYsNDkuMTgsNTBhOC42Nyw4LjY3LDAsMCwwLDEzLTcuNDlWOC42M2E4LjY0LDguNjQsMCwwLDAtMTcuMjgsMHYxOUwyOC40NiwxOC4xYTguNjQsOC42NCwwLDEsMC04LjYzLDE1Wk04NC4yNSw1MS4xM2E4LjU3LDguNTcsMCwwLDAsNS0xLjEzbDI5LjM0LTE2Ljk0YTguNjQsOC42NCwwLDEsMC04LjYzLTE1TDkzLjUzLDI3LjU5di0xOWE4LjY0LDguNjQsMCwwLDAtMTcuMjgsMFY0Mi41MUE4LjY0LDguNjQsMCwwLDAsODQuMjUsNTEuMTNaTTU0LjE5LDg4YTguNDksOC40OSwwLDAsMC01LDEuMTNMMTkuODMsMTA2YTguNjQsOC42NCwwLDEsMCw4LjYzLDE1bDE2LjQ0LTkuNDh2MTlhOC42NCw4LjY0LDAsMSwwLDE3LjI4LDBWOTYuNTZBOC42Myw4LjYzLDAsMCwwLDU0LjE5LDg4Wm0tOC0xNS44N2E4LjQ1LDguNDUsMCwwLDAsLjM5LTIuODEsOSw5LDAsMCwwLS4zMS0yLDguNTYsOC41NiwwLDAsMC00LTUuMThMMTMsNDUuMTFhOC42NCw4LjY0LDAsMCwwLTguNjQsMTVsMTYuMzksOS40OEw0LjMyLDc5QTguNjQsOC42NCwwLDAsMCwxMyw5NEw0Mi4yOSw3N0E4LjU0LDguNTQsMCwwLDAsNDYuMjMsNzIuMDhabTM2NC01MC42M2gtMS40M2ExOC45LDE4LjksMCwwLDAtNiwuODYsMTAuOTIsMTAuOTIsMCwwLDAtNC45MiwzLjJoMEExMywxMywwLDAsMCwzOTUuMDcsMzFhMjksMjksMCwwLDAtLjgsNy4xMnY1LjE4aC01LjcxQTMuNTUsMy41NSwwLDAsMCwzODUsNDYuNzdhMy44NCwzLjg0LDAsMCwwLDEsMi42NywzLjkyLDMuOTIsMCwwLDAsMi41NiwxLjE3aDUuNjdWOTIuODVhMy41OSwzLjU5LDAsMCwwLDEuMDgsMi41NSwzLjc4LDMuNzgsMCwwLDAsMi42MSwxLDMuNTYsMy41NiwwLDAsMCwzLjUxLTMuNThWNTAuNjFoNi4xNGEzLjg3LDMuODcsMCwwLDAsMi41NS0xLjE0LDMuNzIsMy43MiwwLDAsMCwxLjA4LTIuNjNWNDYuN2EzLjU1LDMuNTUsMCwwLDAtMy41OS0zLjQ1aC02LjE4VjM4LjA5YTIxLjE0LDIxLjE0LDAsMCwxLC42Mi01LjIzLDYuMzMsNi4zMywwLDAsMSwxLjE5LTIuNTJBNC4wOSw0LjA5LDAsMCwxLDQwNSwyOS4yNmExMS44NCwxMS44NCwwLDAsMSwzLjYyLS40NWguMTlsLjI4LDAsLjMzLDBoLjgxYTMuNjgsMy42OCwwLDEsMCwwLTcuMzZabTEyNi42LDI3LjMzYTMuNjgsMy42OCwwLDAsMCwxLjExLTIuNiwzLjQyLDMuNDIsMCwwLDAtMS4xMi0yLjUxaDBsMCwwLDAsMGgwYTMuNSwzLjUsMCwwLDAtNS4wNiwwTDUwMy40OSw3MS4xOVYyNC45YTMuNjcsMy42NywwLDAsMC0zLjcyLTMuNjIsMy42LDMuNiwwLDAsMC0yLjU0LDEuMDcsMy42NywzLjY3LDAsMCwwLTEuMDcsMi41NVY5Mi42NmEzLjY1LDMuNjUsMCwwLDAsMy42MSwzLjYxLDMuNjcsMy42NywwLDAsMCwzLjcyLTMuNjFWODEuNDhsOS4yMS05LjE5LDE4Ljc2LDIyLjYzYTIuOTEsMi45MSwwLDAsMCwxLjMsMS4wNyw0LjUsNC41LDAsMCwwLDEuNTQuMjgsMy43OSwzLjc5LDAsMCwwLDIuMzYtLjc3bC4wNSwwLDAsMGEzLjgxLDMuODEsMCwwLDAsMS4xOC0yLjczLDMuNzYsMy43NiwwLDAsMC0uODktMi40aDBsLTE5LjEtMjMuMjEsMTguOS0xOC4yOVptLTUxLTQuNjZhMy42MSwzLjYxLDAsMCwxLDEuMDgsMi41OVY5Mi42NmEzLjY0LDMuNjQsMCwwLDEtMy42MSwzLjYxLDMuNjcsMy42NywwLDAsMS0yLjU1LTEuMDcsMy41OCwzLjU4LDAsMCwxLTEuMDctMi41NFY4OC4xOGEyNC4xOSwyNC4xOSwwLDAsMS0zNS45MS4yMiwyNy41MywyNy41MywwLDAsMSwwLTM3LjQzLDI0LjMzLDI0LjMzLDAsMCwxLDM1LjkxLjEyVjQ2LjcxYTMuNjIsMy42MiwwLDAsMSwxLjA5LTIuNTksMy43LDMuNywwLDAsMSw1LjA2LDBabS02LjE1LDI1LjU3YTIwLjIsMjAuMiwwLDAsMC01LjMzLTEzLjgyLDE3LDE3LDAsMCwwLTI1LjMzLDAsMjAuMjIsMjAuMjIsMCwwLDAtNS4zNiwxMy44MkEyMCwyMCwwLDAsMCw0NDksODMuNDRhMTcuMTgsMTcuMTgsMCwwLDAsMjUuMzUsMEEyMC4wNywyMC4wNywwLDAsMCw0NzkuNjgsNjkuNjlaTTE4OC44LDY4LjRhODcuMjcsODcuMjcsMCwwLDAtOS41My0zLjQ5LDY1LjE1LDY1LjE1LDAsMCwxLTguMzMtMyw4LjA5LDguMDksMCwwLDEtMi41Mi0xLjkyLDMuNTcsMy41NywwLDAsMS0uODYtMi4zOSw1LjcyLDUuNzIsMCwwLDEsMS0zLjM1QTkuNzgsOS43OCwwLDAsMSwxNzMuMDYsNTFhMTQuNjQsMTQuNjQsMCwwLDEsNS4xMi0xLjA2LDE0LjE1LDE0LjE1LDAsMCwxLDguNjgsMi43OWMxLC43MSwxLjgyLDEuNDQsMi42LDJhNi4yNSw2LjI1LDAsMCwwLDEuMjIuOCwzLjE2LDMuMTYsMCwwLDAsMS40My4zOCwyLjU2LDIuNTYsMCwwLDAsMS0uMiwzLjEsMy4xLDAsMCwwLC44OC0uNTUsMywzLDAsMCwwLC42NS0uODgsMi41OCwyLjU4LDAsMCwwLC4yMS0xLDMuODEsMy44MSwwLDAsMC0uNS0xLjgxLDExLDExLDAsMCwwLTIuNDUtMi45LDI0LjQxLDI0LjQxLDAsMCwwLTYtMy43OCwxNy42NiwxNy42NiwwLDAsMC03LTEuNzFjLTUuMzcsMC05Ljg1LDEuMjItMTMuMTEsMy40NmExMy43NywxMy43NywwLDAsMC00LjI0LDQuMjIsMTMuNTksMTMuNTksMCwwLDAtMS43NSw2Ljgxdi4zOGExMC44MywxMC44MywwLDAsMCwyLjI3LDYuODNjMi4xMywyLjY4LDUuMjgsNC4yOSw4LjM3LDUuNDNzNi4xNiwxLjgyLDguMTEsMi40N2EzOS4yNSwzOS4yNSwwLDAsMSw3Ljc4LDMuMjFBOS4xNyw5LjE3LDAsMCwxLDE4OC44Myw3OGE0LjcxLDQuNzEsMCwwLDEsLjksMi43MXYuMDhhNi4yNyw2LjI3LDAsMCwxLTEuMjEsMy43OCwxMC42MiwxMC42MiwwLDAsMS01LDMuMzcsMTcuMzksMTcuMzksMCwwLDEtNS4zNywxLDIxLjU2LDIxLjU2LDAsMCwxLTEwLjA5LTIuMjZjLTEuMTQtLjU3LTIuMDYtMS4xMy0yLjktMS42MS0uNDEtLjIyLS44LS40My0xLjIxLS42YTMuNDMsMy40MywwLDAsMC0xLjMtLjI3LDIuNDgsMi40OCwwLDAsMC0uOTEuMTcsMi4zNiwyLjM2LDAsMCwwLS43OS41MiwzLjY3LDMuNjcsMCwwLDAtLjc5LDEsMi43NywyLjc3LDAsMCwwLS4yOCwxLjIzLDMuNTQsMy41NCwwLDAsMCwuNjQsMS45NCw5Ljg5LDkuODksMCwwLDAsMi41NCwyLjM2LDMxLjMxLDMxLjMxLDAsMCwwLDQsMi4yMSwyOC45LDI4LjksMCwwLDAsMTEuMDksMi41aDBjNS4xNSwwLDkuNjEtMS4xOSwxMy4zNi00aDBhMTQuMzcsMTQuMzcsMCwwLDAsNS45NS0xMS41MSwxMi42LDEyLjYsMCwwLDAtMS42NC02LjQ4QTE1LjUzLDE1LjUzLDAsMCwwLDE4OC44LDY4LjRaTTQyNS4xNywyMS4yOGEzLjYyLDMuNjIsMCwwLDAtMi41NCwxLjA3LDMuNTgsMy41OCwwLDAsMC0xLjA3LDIuNTVWOTIuNjZhMy41NCwzLjU0LDAsMCwwLDEuMDcsMi41NCwzLjY3LDMuNjcsMCwwLDAsNi4yNi0yLjU0VjI0LjlBMy42NywzLjY3LDAsMCwwLDQyNS4xNywyMS4yOFpNNTkxLjU2LDY4di4zNmEzLjMxLDMuMzEsMCwwLDEtMS4xMywyLjQ5LDMuNzgsMy43OCwwLDAsMS0yLjUuOTJINTQ3LjM3YzEsOS45LDguOTMsMTcuMiwxOC4zNywxNy4yOGgyLjM5QTE1LjkzLDE1LjkzLDAsMCwwLDU3Nyw4Ni4xOGEyMiwyMiwwLDAsMCw2LjYzLTcsMy4zMSwzLjMxLDAsMCwxLDEuMzQtMS4yOSwzLjQzLDMuNDMsMCwwLDEsMS42OS0uNDMsMy42MywzLjYzLDAsMCwxLDEuODQuNWwwLDAsMCwwYTMuOTEsMy45MSwwLDAsMSwxLjY1LDMuMTQsMy42NiwzLjY2LDAsMCwxLS41MSwxLjg3djBoMGEzMC40NSwzMC40NSwwLDAsMS05LDkuMjcsMjMsMjMsMCwwLDEtMTIuNTEsMy45MUg1NjUuN2EyNS40NiwyNS40NiwwLDAsMS0xOC4xOS03Ljg3QTI2LjcxLDI2LjcxLDAsMCwxLDU0MCw2OS43OWEyNy4wOSwyNy4wOSwwLDAsMSw3LjU0LTE4Ljg2LDI1LjM5LDI1LjM5LDAsMCwxLDE4LjMzLTcuODEsMjUsMjUsMCwwLDEsMTcuNTcsNy4xOCwyNy40OCwyNy40OCwwLDAsMSw4LjA3LDE3LjYzWm0tNy45Mi0zLjQyQTE4LjQ2LDE4LjQ2LDAsMCwwLDU2NS45LDUwLjNhMTguNjcsMTguNjcsMCwwLDAtMTgsMTQuMjZaTTIyNy4zNCw0My4yMWEyMS43NywyMS43NywwLDAsMC0xNC42OCw1LjczVjQ2LjgzYTMuNywzLjcsMCwwLDAtMS0yLjUzLDMuNDgsMy40OCwwLDAsMC0yLjUxLTEuMDksMy41NywzLjU3LDAsMCwwLTMuNjIsMy42MlY5My43NGwuMTUuMTV2MGExLjg1LDEuODUsMCwwLDAsLjI0LjQ5LDMuODksMy44OSwwLDAsMCwyLjMsMS44MmwuMTUsMGguNzhhMy42OCwzLjY4LDAsMCwwLDEuNTQtLjM1QTMuMTQsMy4xNCwwLDAsMCwyMTEuOCw5NWgwcy4wNS0uMDkuMS0uMTMsMCwwLDAsMGEzLjI2LDMuMjYsMCwwLDAsLjQ1LS43NCw1LjM1LDUuMzUsMCwwLDAsLjIyLS43NWwwLS4xM1Y2NWExNSwxNSwwLDAsMSw0LjQyLTEwLjMyQTE0LjU1LDE0LjU1LDAsMCwxLDI0MS45Miw2NVY5Mi42NmEzLjYzLDMuNjMsMCwwLDAsNi4xNSwyLjU5LDMuNTksMy41OSwwLDAsMCwxLjA4LTIuNTlWNjVBMjEuODcsMjEuODcsMCwwLDAsMjI3LjM0LDQzLjIxWk0yOTkuMjIsNTFhMjcuNDMsMjcuNDMsMCwwLDEsMCwzNy4zNywyNC4xOCwyNC4xOCwwLDAsMS0zNS43NiwwLDI3LjM0LDI3LjM0LDAsMCwxLDAtMzcuMzcsMjQuMjMsMjQuMjMsMCwwLDEsMzUuNzYsMFptLjEsMTguNjlBMjAuMTcsMjAuMTcsMCwwLDAsMjk0LDU1LjkxYTE2LjkzLDE2LjkzLDAsMCwwLTI1LjMsMCwyMC4xNywyMC4xNywwLDAsMC01LjM2LDEzLjc4LDIwLDIwLDAsMCwwLDUuMzYsMTMuNzEsMTcsMTcsMCwwLDAsMjUuMywwQTIwLDIwLDAsMCwwLDI5OS4zMiw2OS42OVptNzgtMjYuMTdoMGEzLjI5LDMuMjksMCwwLDAtMS4zLS4yNywzLjcyLDMuNzIsMCwwLDAtMy4zOSwyLjIydjBsLTEzLjgsMzcuNzhMMzQ4LjE5LDU3LjkyaDBhMy42MywzLjYzLDAsMCwwLTEuNDQtMS42MywzLjkzLDMuOTMsMCwwLDAtMi4wNy0uNTksMy43OSwzLjc5LDAsMCwwLTMuNDEsMi4yMmgwTDMzMC41OCw4My4yNywzMTYuNyw0NS41aDBhMy4xOSwzLjE5LDAsMCwwLTEuMzItMS42OCwzLjcyLDMuNzIsMCwwLDAtMi0uNTksMy41OCwzLjU4LDAsMCwwLTEuMzYuMjdoMGwwLDBhMy42MiwzLjYyLDAsMCwwLTEuODMsNC42M2gwTDMyNy4yLDk0djBhMy41OCwzLjU4LDAsMCwwLC42LDEsMywzLDAsMCwwLC43OS42LDIuMjIsMi4yMiwwLDAsMCwuMjguMjEsMS42MywxLjYzLDAsMCwwLC41MS4xOSwzLjc5LDMuNzksMCwwLDAsMS4yNS4yNCwzLjU0LDMuNTQsMCwwLDAsMS45MS0uNjEsMy4zNCwzLjM0LDAsMCwwLDEuMjgtMS41OWwuMDUsMCwxMC43OS0yNS44LDEwLjgxLDI1LjdoMGEzLjUxLDMuNTEsMCwwLDAsMS4yLDEuNiwzLjgsMy44LDAsMCwwLDEuNzcuNzRoLjQ1YTMuMywzLjMsMCwwLDAsMS4yMS0uMjIsNCw0LDAsMCwwLC45Mi0uNTEsNC4yNyw0LjI3LDAsMCwwLDEuMy0xLjczdjBsMTctNDUuNjNhMy41NywzLjU3LDAsMCwwLTEuOTMtNC42M1oiLz48L3N2Zz4='
"""SnowGram renderer v3 — layout-engine geometry + an embedded DOCUMENTATION PANEL
(overview, component summary, best practices, hyperlinked sources) rendered UNDER
the diagram in every modality so each exported file is a self-contained artifact.

enrich = {
  "icons": {node_id: svg_data_uri},
  "edgeLabels": {"from|to": label},
  "doc": {
    "overview": "...",
    "components": [{"component": "...", "role": "..."}],
    "best_practices": [{"text": "...", "source_title": "...", "source_url": "..."}]
  }
}
The panel is OPTIONAL — absent/empty doc => diagram only (backward compatible).
"""

PAL = {
    'onprem':  ('#EEF1F5', '#9AA4B2'),
    'bridge':  ('#E0F7FA', '#00ACC1'),
    'snow':    ('#E8F4FD', '#29B5E8'),
    'outcome': ('#FFF7E6', '#F2A900'),
    'default': ('#F5F5F5', '#999999'),
}


def _sid(s):
    out = ''.join(ch if ch.isalnum() else '_' for ch in str(s))
    if not out:
        out = 'n'
    if out[0].isdigit():
        out = 'n' + out
    return out


def _xesc(s):
    s = '' if s is None else str(s)
    return (s.replace('&', '&amp;').replace('<', '&lt;')
             .replace('>', '&gt;').replace('"', '&quot;'))


def _mlabel(s):
    s = '' if s is None else str(s)
    return s.replace('"', "'").replace('|', '/').replace('\\n', ' ')


def _drawio_img(uri):
    if not uri:
        return ''
    if uri.startswith('data:') and ';base64,' in uri:
        head, b64 = uri.split(';base64,', 1)
        return head + ',' + b64
    return uri


def _pal(cat):
    return PAL.get(cat or 'default', PAL['default'])


def _containers_sorted(layout):
    """Containers ordered shallow-to-deep (top-level first, nested last),
    so a render loop draws outer boxes before inner ones -- guarantees an
    inner box/label is never visually buried under one drawn later on top.
    """
    cs = layout.get('containers', []) or []
    by_id = {c.get('id'): c for c in cs}
    depth_cache = {}

    def depth(cid, seen=None):
        if cid in depth_cache:
            return depth_cache[cid]
        seen = seen or set()
        if cid is None or cid in seen or cid not in by_id:
            return 0
        seen.add(cid)
        parent = by_id[cid].get('parentId')
        d = 0 if parent is None else 1 + depth(parent, seen)
        depth_cache[cid] = d
        return d

    return sorted(cs, key=lambda c: depth(c.get('id')))


def _wrap(s, n=20):
    s = '' if s is None else str(s)
    words, lines, cur = s.split(), [], ''
    for w in words:
        if len(cur) + len(w) + (1 if cur else 0) <= n:
            cur = (cur + ' ' + w) if cur else w
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines or ['']


def _clean_points(pts):
    """Normalize a connector polyline so its segments join cleanly:
    drop non-numeric points, collapse consecutive duplicates (zero-length
    segments), and remove collinear intermediate points that lie between
    their neighbors (kinks that look like a break in the line)."""
    out = []
    for p in pts:
        try:
            q = (float(p[0]), float(p[1]))
        except (TypeError, ValueError, IndexError):
            continue
        if out and abs(q[0] - out[-1][0]) < 0.01 and abs(q[1] - out[-1][1]) < 0.01:
            continue
        out.append(q)
    i = 1
    while i < len(out) - 1:
        ax, ay = out[i - 1]
        bx, by = out[i]
        cx, cy = out[i + 1]
        cross = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
        between = (min(ax, cx) - 0.01 <= bx <= max(ax, cx) + 0.01 and
                   min(ay, cy) - 0.01 <= by <= max(ay, cy) + 0.01)
        if abs(cross) < 0.5 and between:
            del out[i]
        else:
            i += 1
    return out


def _edge_label_point(pts, node_boxes, placed_boxes, label_len):
    """Pick where an edge's label text should sit along its polyline.

    The naive approach (pts[len(pts)//2]) picks the middle WAYPOINT INDEX,
    not a true position -- for a short or lopsided path that point can land
    right on top of an endpoint's icon, and gives no way to notice when two
    different edges' labels would land on top of each other. This walks the
    polyline by actual distance and tries a small set of candidate fractions
    (starting at the true midpoint, then progressively further out), picking
    the first one that clears every node's icon/label box AND every label
    already placed by an earlier edge -- falling back to the plain midpoint
    if nothing clears (never worse than the old behavior).
    """
    if len(pts) < 2:
        return pts[0] if pts else (0.0, 0.0)
    seg_lens = []
    total = 0.0
    for i in range(len(pts) - 1):
        dx = pts[i + 1][0] - pts[i][0]
        dy = pts[i + 1][1] - pts[i][1]
        l = (dx * dx + dy * dy) ** 0.5
        seg_lens.append(l)
        total += l
    if total <= 0:
        return tuple(pts[len(pts) // 2])

    def point_at(frac):
        target_d = total * frac
        acc = 0.0
        for i, l in enumerate(seg_lens):
            if acc + l >= target_d or i == len(seg_lens) - 1:
                t = 0.0 if l == 0 else max(0.0, min(1.0, (target_d - acc) / l))
                x = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t
                y = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t
                return (x, y)
            acc += l
        return tuple(pts[-1])

    half_w = max(20.0, label_len * 3.2)
    half_h = 8.0

    def label_box(pt):
        return (pt[0] - half_w, pt[1] - half_h, pt[0] + half_w, pt[1] + half_h)

    def overlaps(a, b, pad=0.0):
        return not (a[2] + pad < b[0] or b[2] + pad < a[0] or a[3] + pad < b[1] or b[3] + pad < a[1])

    for frac in (0.5, 0.4, 0.6, 0.3, 0.7, 0.22, 0.78):
        pt = point_at(frac)
        box = label_box(pt)
        if any(overlaps(box, nb, pad=4.0) for nb in node_boxes):
            continue
        if any(overlaps(box, pb) for pb in placed_boxes):
            continue
        return pt
    return point_at(0.5)


def _doc_norm(doc):
    if not isinstance(doc, dict):
        return None
    comps = doc.get('components') or []
    bps = doc.get('best_practices') or []
    ov = doc.get('overview')
    if not comps and not bps and not ov:
        return None
    return {'overview': ov, 'components': comps, 'best_practices': bps}


# ---------------- Shared edge-category helpers ----------------
# Used by both _svg() and _html() so connector styling is consistent across
# all four artifact types without duplicating the classification logic.
def _node_meta(layout):
    meta = {}
    for n in (layout.get("nodes") or []):
        meta[n["id"]] = {
            "label": n.get("label") or n["id"],
            "componentType": n.get("componentType") or "",
        }
    return meta

def _edge_cat(e, lbl, node_meta):
    src = node_meta.get(e.get("from")) or {}
    tgt = node_meta.get(e.get("to")) or {}
    blob = " ".join([
        (lbl or ""),
        str(src.get("componentType") or ""), str(src.get("label") or ""),
        str(tgt.get("componentType") or ""), str(tgt.get("label") or ""),
    ]).lower()
    if "legacy" in blob:
        return "legacy"
    if any(k in blob for k in ("governance", "catalog", "polic", "lineage", "mask", "classif", "horizon")):
        return "governance"
    return "dataflow"


# ---------------- SVG (diagram + doc panel) ----------------
def _svg(layout, icons, edge_labels, title, doc, edge_bidir=None, edge_styles=None):
    edge_bidir = edge_bidir or {}
    edge_styles = edge_styles or {}
    W = int(round(layout.get("width") or 800)) + 40
    diagram_h = int(round(layout.get("height") or 400))
    yoff = 50 if title else 12
    body = []

    def X(v):
        return round(float(v) + 20, 1)

    def Y(v):
        return round(float(v) + yoff, 1)

    if title:
        body.append("<text x=\"20\" y=\"32\" font-size=\"20\" font-weight=\"bold\" fill=\"#11162e\">" + _xesc(title) + "</text>")
    if _LOGO_DATA_URI:
        body.append("<image href=\"" + _LOGO_DATA_URI + "\" xlink:href=\"" + _LOGO_DATA_URI +
                    "\" x=\"" + str(W - 97 - 18) + "\" y=\"12\" width=\"97\" height=\"22\" preserveAspectRatio=\"xMidYMid meet\"/>")
    b = layout.get("platformBoundary")
    if b:
        b_label = str(b.get("label") or "Snowflake Data Cloud")
        b_sub = str(b.get("subtitle") or "")
        body.append("<rect x=\"" + str(X(b["x"])) + "\" y=\"" + str(Y(b["y"])) + "\" width=\"" + str(round(b["w"], 1)) +
                    "\" height=\"" + str(round(b["h"], 1)) + "\" rx=\"14\" fill=\"none\" stroke=\"#29B5E8\" stroke-width=\"2\" stroke-dasharray=\"8 5\"/>")
        body.append("<text x=\"" + str(X(b["x"]) + 12) + "\" y=\"" + str(Y(b["y"]) + 20) + "\" font-size=\"12\" font-weight=\"bold\" fill=\"#29B5E8\">" + _xesc(b_label) + "</text>")
        if b_sub:
            body.append("<text x=\"" + str(X(b["x"]) + 12) + "\" y=\"" + str(Y(b["y"]) + 33) + "\" font-size=\"9.5\" fill=\"#29B5E8\" opacity=\"0.75\">" + _xesc(b_sub) + "</text>")
    for c in _containers_sorted(layout):
        cc = str(c.get("color") or "#7C5CFC")
        body.append("<rect x=\"" + str(X(c["x"])) + "\" y=\"" + str(Y(c["y"])) + "\" width=\"" + str(round(c["w"], 1)) +
                    "\" height=\"" + str(round(c["h"], 1)) + "\" rx=\"12\" fill=\"none\" stroke=\"" + cc + "\" stroke-width=\"1.75\" stroke-dasharray=\"5 3\"/>")
        sub = str(c.get("subtitle") or "")
        body.append("<text x=\"" + str(X(c["x"]) + 12) + "\" y=\"" + str(Y(c["y"]) + 18) + "\" font-size=\"11\" font-weight=\"bold\" fill=\"" + cc + "\" letter-spacing=\"0.4\">" + _xesc(str(c.get("label") or c["id"]).upper()) + "</text>")
        if sub:
            body.append("<text x=\"" + str(X(c["x"]) + 12) + "\" y=\"" + str(Y(c["y"]) + 31) + "\" font-size=\"9\" fill=\"" + cc + "\" opacity=\"0.75\">" + _xesc(sub) + "</text>")
    for z in layout.get("zones", []):
        fill, stroke = _pal(z.get("category"))
        body.append("<rect x=\"" + str(X(z["x"])) + "\" y=\"" + str(Y(z["y"])) + "\" width=\"" + str(round(z["w"], 1)) +
                    "\" height=\"" + str(round(z["h"], 1)) + "\" rx=\"10\" fill=\"" + fill + "\" stroke=\"" + stroke + "\" stroke-width=\"1.5\"/>")
        body.append("<text x=\"" + str(X(z["x"]) + 12) + "\" y=\"" + str(Y(z["y"]) + 22) + "\" font-size=\"13\" font-weight=\"bold\" fill=\"#11162e\">" + _xesc(z["name"]) + "</text>")

    # Node metadata (component type and label) keyed by id, used to classify
    # each connector as data flow, governance, or legacy so the three read
    # as visually distinct families (color, dash pattern, weight) instead
    # of one uniform gray line for every relationship.
    node_meta = _node_meta(layout)
    def edge_category(e, lbl):
        return _edge_cat(e, lbl, node_meta)

    edge_style = {
        "dataflow": {"stroke": "#5b6770", "width": "1.8", "dash": None, "marker": "ah-dataflow"},
        "governance": {"stroke": "#7C5CFC", "width": "1.5", "dash": "1.5 3", "marker": "ah-governance"},
        "legacy": {"stroke": "#C08A3E", "width": "1.4", "dash": "7 4", "marker": "ah-legacy"},
        "private_link": {"stroke": "#2E9E4F", "width": "1.8", "dash": None, "marker": "ah-private_link"},
        "data_share": {"stroke": "#1763c6", "width": "2.2", "dash": None, "marker": "ah-data_share"},
    }

    node_boxes = [(float(n["x"]), float(n["y"]), float(n["x"]) + float(n["w"]), float(n["y"]) + float(n["h"])) for n in layout.get("nodes", [])]
    # Zone/container/boundary title text sits in the top-left corner of each
    # box -- treat that strip as an obstacle too, or an edge label routed
    # near a zone header can land directly on top of its bold title (found
    # via direct visual review: "read over Azure Private Link" landed
    # right across the word "Ingestion").
    for z in layout.get("zones", []):
        name_w = len(str(z.get("name") or "")) * 7.8
        node_boxes.append((float(z["x"]) + 8, float(z["y"]) + 6, float(z["x"]) + 8 + name_w, float(z["y"]) + 28))
    for c in _containers_sorted(layout):
        name_w = len(str(c.get("label") or c["id"])) * 6.8
        node_boxes.append((float(c["x"]) + 8, float(c["y"]) + 4, float(c["x"]) + 8 + name_w, float(c["y"]) + 22))
    label_claimed = set()
    placed_label_boxes = []
    cats_used = set()
    for e in layout.get("edges", []):
        pts = _clean_points(e.get("points") or [])
        if len(pts) < 2:
            continue
        lbl = edge_labels.get(str(e.get("from")) + "|" + str(e.get("to")))
        explicit = edge_styles.get(str(e.get("from")) + "|" + str(e.get("to")))
        cat = explicit if explicit in edge_style else edge_category(e, lbl)
        cats_used.add(cat)
        st = edge_style[cat]
        d = "M" + str(X(pts[0][0])) + "," + str(Y(pts[0][1]))
        for q in pts[1:]:
            d += " L" + str(X(q[0])) + "," + str(Y(q[1]))
        dash_attr = (" stroke-dasharray=\"" + st["dash"] + "\"") if st["dash"] else ""
        is_bidir = bool(edge_bidir.get(str(e.get("from")) + "|" + str(e.get("to"))))
        marker_start_attr = (" marker-start=\"url(#" + st["marker"] + "-start)\"") if is_bidir else ""
        body.append("<path d=\"" + d + "\" fill=\"none\" stroke=\"" + st["stroke"] + "\" stroke-width=\"" + st["width"] +
                    "\" stroke-linejoin=\"round\" stroke-linecap=\"round\"" + dash_attr + marker_start_attr + " marker-end=\"url(#" + st["marker"] + ")\"/>")
        if lbl:
            # Several sibling edges sharing a target or source often carry
            # the IDENTICAL label (e.g. 3 sources all labeled "extract" into
            # one dbt node, or a governance node fanning "policies and
            # lineage" out 3 times) -- showing the same text 2-3x right on
            # top of each other is pure clutter, not new information.
            # Render it once per (node, label) pair; still draw every line.
            src_key = (e.get("from"), lbl)
            tgt_key = (e.get("to"), lbl)
            if src_key in label_claimed or tgt_key in label_claimed:
                lbl = None
            else:
                label_claimed.add(src_key)
                label_claimed.add(tgt_key)
        if lbl:
            mp = _edge_label_point(pts, node_boxes, placed_label_boxes, len(lbl))
            placed_label_boxes.append((mp[0] - max(20.0, len(lbl) * 3.2), mp[1] - 8.0, mp[0] + max(20.0, len(lbl) * 3.2), mp[1] + 8.0))
            # Two separate <text> elements (white halo painted first, dark
            # fill painted second/on top) instead of one element relying on
            # paint-order="stroke" -- weasyprint (the renderer behind the
            # PNG/PDF export path, _svg_to_pdf_png) does NOT support
            # paint-order and falls back to the SVG default (stroke ON TOP
            # of fill), so the white halo completely covered the dark text,
            # leaving only a solid white blob sitting on the connector line
            # -- exactly reading as a broken/disconnected line segment.
            # Found 2026-09-10 (user: "text labels showing up as white on a
            # white background, that's what makes it look like there's line
            # breaks"). Two ordered elements are honored identically by
            # every renderer (browsers, weasyprint, any SVG viewer) since
            # paint order there is just DOM/document order, not a CSS
            # feature that can be unsupported.
            _lx, _ly = str(X(mp[0])), str(Y(mp[1]) - 4)
            body.append("<text x=\"" + _lx + "\" y=\"" + _ly + "\" font-size=\"10\" fill=\"none\" text-anchor=\"middle\" stroke=\"#ffffff\" stroke-width=\"3\" stroke-linejoin=\"round\">" + _xesc(lbl) + "</text>")
            body.append("<text x=\"" + _lx + "\" y=\"" + _ly + "\" font-size=\"10\" fill=\"#5b6770\" text-anchor=\"middle\">" + _xesc(lbl) + "</text>")

    # Node cards are drawn AFTER (i.e. visually on top of) every connector
    # path above -- an opaque card hides whatever portion of a routed line
    # falls inside its own footprint, which is exactly how the interactive
    # HTML viewer avoids ever showing a line crossing a card: connectors sit
    # in a layer underneath the opaque card divs there. Giving the static
    # SVG the same real, opaque card boundary (instead of a bare floating
    # icon with nothing to paint over an incoming wire) gets the same
    # effect for free, so lines visually stop right at a card edge instead
    # of visibly cutting across its icon or label.
    icon_box = 38
    for n in layout.get("nodes", []):
        x, y, w, h = float(n["x"]), float(n["y"]), float(n["w"]), float(n["h"])
        rx, ry = X(x), Y(y)
        uri = icons.get(n["id"])
        label = n.get("label") or n["id"]
        _ct = n.get("componentType") or ""
        # Drop the uppercase type eyebrow when the type already appears as a
        # whole-word phrase in the label (see _type_echoes): "Azure Synapse",
        # "Bronze Dynamic Table", "Power BI (Legacy)" all repeat their type.
        # Keep it when it adds info beyond the label ("Arcadia Health (Snowflake)"
        # -> "SNOWFLAKE ACCOUNT", "Snowflake Horizon" -> "GOVERNANCE").
        sub = "" if _type_echoes(_ct, label) else _ct.upper()
        if n.get("style") == "gateway":
            # Small icon-only chip + caption underneath, no card chrome --
            # visually reads as network plumbing (a bridge/connector), not a
            # full service, for nodes like Azure Private Link / AWS PrivateLink.
            # Icon center is a FIXED offset from the box's own top (ry), NOT
            # centered in h -- h can be taller than the chip itself (row-band-
            # shared with a taller sibling card), but the connector port
            # (measure.mjs's iconCenterY = GATEWAY.padTop + GATEWAY.iconBox/2,
            # i.e. top+24) is always anchored to that same fixed offset.
            gsz = 32
            gcx, gcy = rx + w / 2, ry + 24
            body.append("<rect x=\"" + str(round(gcx - gsz / 2, 1)) + "\" y=\"" + str(round(gcy - gsz / 2, 1)) +
                        "\" width=\"" + str(gsz) + "\" height=\"" + str(gsz) +
                        "\" rx=\"9\" fill=\"#eaf6fc\" stroke=\"#29B5E8\" stroke-width=\"1.25\" stroke-dasharray=\"3 2\"/>")
            if uri:
                im = gsz - 10
                body.append("<image x=\"" + str(round(gcx - im / 2, 1)) + "\" y=\"" + str(round(gcy - im / 2, 1)) +
                            "\" width=\"" + str(im) + "\" height=\"" + str(im) +
                            "\" preserveAspectRatio=\"xMidYMid meet\" href=\"" + uri + "\" xlink:href=\"" + uri + "\"/>")
            cap_lines = _wrap(label, 14)
            cap_y = gcy + gsz / 2 + 11
            for j, ln in enumerate(cap_lines):
                body.append("<text x=\"" + str(round(gcx, 1)) + "\" y=\"" + str(round(cap_y + j * 10, 1)) +
                            "\" font-size=\"9\" font-weight=\"600\" fill=\"#5b6678\" text-anchor=\"middle\">" + _xesc(ln) + "</text>")
            continue
        if n.get("style") == "chip":
            # Small pill with the label inline -- one stage of an inline
            # medallion pipeline (Bronze -> Silver -> Gold), not a full card.
            # Positioned at a FIXED offset from the box's own top (ry), NOT
            # centered in the box's full h -- h can be taller than the pill
            # itself (row-band-shared with a taller sibling card elsewhere),
            # but the connector port (measure.mjs's iconCenterY = CHIP.height/2,
            # i.e. top+15) is always anchored to that same fixed top offset.
            # Found via direct coordinate check (2026-09-09): centering the
            # pill in a 98px-tall inflated box put its visual center 34px
            # below where the connector arrived, so the arrowhead floated
            # well above the pill instead of touching it.
            chip_h = 30.0
            chip_ty = ry
            body.append("<rect x=\"" + str(round(rx, 1)) + "\" y=\"" + str(round(chip_ty, 1)) + "\" width=\"" + str(round(w, 1)) +
                        "\" height=\"" + str(chip_h) + "\" rx=\"15\" fill=\"#eaf6fc\" stroke=\"#29B5E8\" stroke-width=\"1.25\"/>")
            body.append("<text x=\"" + str(round(rx + w / 2, 1)) + "\" y=\"" + str(round(chip_ty + chip_h / 2 + 3.5, 1)) +
                        "\" font-size=\"10.5\" font-weight=\"700\" fill=\"#16203a\" text-anchor=\"middle\">" + _xesc(label) + "</text>")
            continue
        body.append("<rect x=\"" + str(round(rx, 1)) + "\" y=\"" + str(round(ry + 2, 1)) + "\" width=\"" + str(round(w, 1)) +
                    "\" height=\"" + str(round(h, 1)) + "\" rx=\"14\" fill=\"#0a1e3c\" opacity=\"0.10\"/>")
        body.append("<rect x=\"" + str(round(rx, 1)) + "\" y=\"" + str(round(ry, 1)) + "\" width=\"" + str(round(w, 1)) +
                    "\" height=\"" + str(round(h, 1)) + "\" rx=\"14\" fill=\"#ffffff\" stroke=\"#c9d4e3\" stroke-width=\"1\"/>")
        pad = 13
        icx, icy = rx + pad, ry + h / 2 - icon_box / 2
        if uri:
            body.append("<rect x=\"" + str(round(icx, 1)) + "\" y=\"" + str(round(icy, 1)) + "\" width=\"" + str(icon_box) +
                        "\" height=\"" + str(icon_box) + "\" rx=\"11\" fill=\"#eaf6fc\" stroke=\"#29B5E8\" stroke-opacity=\"0.25\"/>")
            im = icon_box - 12
            body.append("<image x=\"" + str(round(icx + 6, 1)) + "\" y=\"" + str(round(icy + 6, 1)) + "\" width=\"" + str(im) +
                        "\" height=\"" + str(im) + "\" preserveAspectRatio=\"xMidYMid meet\" href=\"" + uri + "\" xlink:href=\"" + uri + "\"/>")
            text_x = icx + icon_box + 10
        else:
            text_x = rx + pad
        avail_w = (rx + w - pad) - text_x
        # 5.8px/char (~0.50 of the 11.5px font size) undercounted this BOLD
        # title font's true glyph width -- "Bronze Dynamic" (14 chars)
        # measured as fitting a 91px-wide slot at that ratio but visibly
        # overran the card's own rounded border in the rendered PNG (found
        # via a zoomed screenshot, 2026-09-10). measure.mjs's JS-side line
        # COUNT heuristic (a different estimate, used only to size the
        # card's height) was bumped from 0.52 to 0.58 for this exact same
        # under-count failure mode against bold/uppercase text; use the
        # same 0.58 ratio here for the WIDTH used to decide where to break.
        cpl = max(6, int(avail_w / (11.5 * 0.58)))
        lines = _wrap(label, cpl)
        text_h = len(lines) * 13 + (5 if sub else 0)
        ty = ry + h / 2 - text_h / 2 + 10
        for j, ln in enumerate(lines):
            body.append("<text x=\"" + str(round(text_x, 1)) + "\" y=\"" + str(round(ty + j * 13, 1)) + "\" font-size=\"11.5\" font-weight=\"700\" fill=\"#16203a\">" + _xesc(ln) + "</text>")
        if sub:
            body.append("<text x=\"" + str(round(text_x, 1)) + "\" y=\"" + str(round(ty + len(lines) * 13 + 3, 1)) + "\" font-size=\"8.5\" font-weight=\"600\" fill=\"#5b6678\" letter-spacing=\"0.3\">" + _xesc(sub) + "</text>")

    legend_defs = {"dataflow": "Data flow", "governance": "Governance / policy", "legacy": "Legacy / transitional",
                   "private_link": "Private connectivity", "data_share": "Secure data sharing"}
    legend_y = Y(diagram_h) + 20
    if len(cats_used) > 1:
        lx = 20.0
        for cat in ("dataflow", "governance", "legacy", "private_link", "data_share"):
            if cat not in cats_used:
                continue
            st = edge_style[cat]
            body.append("<line x1=\"" + str(round(lx, 1)) + "\" y1=\"" + str(round(legend_y, 1)) + "\" x2=\"" + str(round(lx + 24, 1)) +
                        "\" y2=\"" + str(round(legend_y, 1)) + "\" stroke=\"" + st["stroke"] + "\" stroke-width=\"" + st["width"] +
                        "\"" + ((" stroke-dasharray=\"" + st["dash"] + "\"") if st["dash"] else "") + "/>")
            body.append("<text x=\"" + str(round(lx + 30, 1)) + "\" y=\"" + str(round(legend_y + 3.5, 1)) + "\" font-size=\"10.5\" fill=\"#5b6678\">" + _xesc(legend_defs[cat]) + "</text>")
            lx += 30 + len(legend_defs[cat]) * 6.2 + 24
        legend_y += 18
    else:
        legend_y = Y(diagram_h)

    panel_top = legend_y + 24
    panel, panel_bottom = _svg_doc_panel(doc, 20, panel_top, W - 40)
    body.extend(panel)
    H = int(round(max(legend_y, panel_bottom))) + 24

    aria = title or (doc.get("overview") if doc else None) or "SnowGram architecture diagram"
    head = ["<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" width=\"" + str(W) + "\" height=\"" + str(H) + "\" viewBox=\"0 0 " + str(W) + " " + str(H) + "\" font-family=\"Arial,Helvetica,sans-serif\" text-rendering=\"geometricPrecision\" shape-rendering=\"geometricPrecision\" role=\"img\" aria-label=\"" + _xesc(aria) + "\">",
            "<title>" + _xesc(aria) + "</title>"]
    if doc and doc.get("overview"):
        head.append("<desc>" + _xesc(doc["overview"]) + "</desc>")
    head.append("<rect x=\"0\" y=\"0\" width=\"" + str(W) + "\" height=\"" + str(H) + "\" fill=\"#ffffff\"/>")
    head.append("<defs>"
                "<marker id=\"ah-dataflow\" markerWidth=\"9\" markerHeight=\"9\" refX=\"7\" refY=\"3\" orient=\"auto\" markerUnits=\"userSpaceOnUse\"><path d=\"M0,0 L7,3 L0,6 Z\" fill=\"#5b6770\"/></marker>"
                "<marker id=\"ah-governance\" markerWidth=\"9\" markerHeight=\"9\" refX=\"7\" refY=\"3\" orient=\"auto\" markerUnits=\"userSpaceOnUse\"><path d=\"M0,0 L7,3 L0,6 Z\" fill=\"#7C5CFC\"/></marker>"
                "<marker id=\"ah-legacy\" markerWidth=\"9\" markerHeight=\"9\" refX=\"7\" refY=\"3\" orient=\"auto\" markerUnits=\"userSpaceOnUse\"><path d=\"M0,0 L7,3 L0,6 Z\" fill=\"#C08A3E\"/></marker>"
                "<marker id=\"ah-private_link\" markerWidth=\"9\" markerHeight=\"9\" refX=\"7\" refY=\"3\" orient=\"auto\" markerUnits=\"userSpaceOnUse\"><path d=\"M0,0 L7,3 L0,6 Z\" fill=\"#2E9E4F\"/></marker>"
                "<marker id=\"ah-data_share\" markerWidth=\"9\" markerHeight=\"9\" refX=\"7\" refY=\"3\" orient=\"auto\" markerUnits=\"userSpaceOnUse\"><path d=\"M0,0 L7,3 L0,6 Z\" fill=\"#1763c6\"/></marker>"
                # Mirrored (tip pointing the opposite way) counterparts for
                # marker-start on a bidirectional edge -- orient="auto" at
                # the path START uses the same forward tangent as the END
                # marker, so reusing the ah-* path as-is would point INTO
                # the line instead of away from it; the geometry has to be
                # pre-mirrored rather than relying on auto-start-reverse
                # (an SVG2 feature not reliably supported by the PDF
                # rasterizer this renderer also feeds).
                "<marker id=\"ah-dataflow-start\" markerWidth=\"9\" markerHeight=\"9\" refX=\"2\" refY=\"3\" orient=\"auto\" markerUnits=\"userSpaceOnUse\"><path d=\"M7,0 L0,3 L7,6 Z\" fill=\"#5b6770\"/></marker>"
                "<marker id=\"ah-governance-start\" markerWidth=\"9\" markerHeight=\"9\" refX=\"2\" refY=\"3\" orient=\"auto\" markerUnits=\"userSpaceOnUse\"><path d=\"M7,0 L0,3 L7,6 Z\" fill=\"#7C5CFC\"/></marker>"
                "<marker id=\"ah-legacy-start\" markerWidth=\"9\" markerHeight=\"9\" refX=\"2\" refY=\"3\" orient=\"auto\" markerUnits=\"userSpaceOnUse\"><path d=\"M7,0 L0,3 L7,6 Z\" fill=\"#C08A3E\"/></marker>"
                "<marker id=\"ah-private_link-start\" markerWidth=\"9\" markerHeight=\"9\" refX=\"2\" refY=\"3\" orient=\"auto\" markerUnits=\"userSpaceOnUse\"><path d=\"M7,0 L0,3 L7,6 Z\" fill=\"#2E9E4F\"/></marker>"
                "<marker id=\"ah-data_share-start\" markerWidth=\"9\" markerHeight=\"9\" refX=\"2\" refY=\"3\" orient=\"auto\" markerUnits=\"userSpaceOnUse\"><path d=\"M7,0 L0,3 L7,6 Z\" fill=\"#1763c6\"/></marker>"
                "</defs>")
    return "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n" + "".join(head + body + ["</svg>"])

def _svg_doc_panel(doc, x, y0, maxw):
    if not doc:
        return [], y0
    p = []
    cur = {'y': y0}
    cpl = max(28, int(maxw / 6.6))  # approx chars per line at 12px

    def text(s, size, color, weight, dx):
        p.append('<text x="' + str(x + dx) + '" y="' + str(round(cur['y'], 1)) + '" font-size="' + str(size) +
                 '" font-weight="' + weight + '" fill="' + color + '">' + _xesc(s) + '</text>')
        cur['y'] += size + 5

    def link(label, url, size, dx):
        p.append('<a href="' + _xesc(url) + '" target="_blank" rel="noopener" xlink:href="' + _xesc(url) +
                 '"><text x="' + str(x + dx) + '" y="' + str(round(cur['y'], 1)) + '" font-size="' + str(size) +
                 '" fill="#1155cc" text-decoration="underline">' + _xesc(label) + '</text></a>')
        cur['y'] += size + 5

    def rule():
        p.append('<line x1="' + str(x) + '" y1="' + str(round(cur['y'] - 6, 1)) + '" x2="' + str(x + maxw) +
                 '" y2="' + str(round(cur['y'] - 6, 1)) + '" stroke="#dfe3e8" stroke-width="1"/>')

    rule()
    if doc.get('overview'):
        text('Architecture Overview', 14, '#11162e', 'bold', 0)
        for ln in _wrap(doc['overview'], cpl):
            text(ln, 12, '#333333', 'normal', 0)
        cur['y'] += 6
    comps = doc.get('components') or []
    if comps:
        text('Component Summary', 14, '#11162e', 'bold', 0)
        for c in comps:
            row = (c.get('component') or '') + ' - ' + (c.get('role') or '')
            wl = _wrap(row, cpl - 2)
            text('- ' + wl[0], 12, '#333333', 'normal', 0)
            for ln in wl[1:]:
                text(ln, 12, '#333333', 'normal', 14)
        cur['y'] += 6
    bps = doc.get('best_practices') or []
    if bps:
        text('Best Practices', 14, '#11162e', 'bold', 0)
        for i, bp in enumerate(bps, 1):
            wl = _wrap(bp.get('text') or '', cpl - 3)
            text(str(i) + '. ' + wl[0], 12, '#333333', 'normal', 0)
            for ln in wl[1:]:
                text(ln, 12, '#333333', 'normal', 16)
            st, su = bp.get('source_title'), bp.get('source_url')
            if su:
                link('Source: ' + (st or su), su, 11, 16)
            elif st:
                text('Source: ' + st, 11, '#777777', 'normal', 16)
        cur['y'] += 4
    srcs = _collect_sources(doc)
    if srcs:
        text('Sources', 14, '#11162e', 'bold', 0)
        for i, sc in enumerate(srcs, 1):
            link(str(i) + '. ' + (sc.get('title') or sc['url']), sc['url'], 11, 0)
        cur['y'] += 4
    return p, cur['y']


# ---------------- draw.io (diagram + doc cell) ----------------
def _drawio(layout, icons, edge_labels, title, doc):
    cells = ['<mxCell id="0"/>', '<mxCell id="1" parent="0"/>']

    def geo(x, y, w, h):
        return '<mxGeometry x="' + str(round(x, 1)) + '" y="' + str(round(y, 1)) + '" width="' + str(round(w, 1)) + '" height="' + str(round(h, 1)) + '" as="geometry"/>'

    if _LOGO_DATA_URI:
        st = 'shape=image;imageAspect=1;aspect=fixed;image=' + _drawio_img(_LOGO_DATA_URI) + ';'
        cells.append('<mxCell id="brand_logo" value="" style="' + _xesc(st) + '" vertex="1" parent="1">' + geo(0, -52, 110, 25) + '</mxCell>')
    b = layout.get('platformBoundary')
    if b:
        st = 'rounded=1;dashed=1;fillColor=none;strokeColor=#29B5E8;verticalAlign=top;fontColor=#29B5E8;fontStyle=1;'
        b_label = str(b.get('label') or 'Snowflake Data Cloud')
        cells.append('<mxCell id="boundary" value="' + _xesc(b_label) + '" style="' + _xesc(st) + '" vertex="1" parent="1">' + geo(b['x'], b['y'], b['w'], b['h']) + '</mxCell>')
    for c in _containers_sorted(layout):
        st = 'rounded=1;dashed=1;dashPattern=5 3;fillColor=none;strokeColor=#7C5CFC;verticalAlign=top;fontColor=#7C5CFC;fontStyle=1;'
        cid = 'container_' + _sid(c['id'])
        cells.append('<mxCell id="' + cid + '" value="' + _xesc(str(c.get('label') or c['id'])) + '" style="' + _xesc(st) + '" vertex="1" parent="1">' + geo(c['x'], c['y'], c['w'], c['h']) + '</mxCell>')
    for i, z in enumerate(layout.get('zones', [])):
        fill, stroke = _pal(z.get('category'))
        st = 'rounded=1;fillColor=' + fill + ';strokeColor=' + stroke + ';verticalAlign=top;fontStyle=1;whiteSpace=wrap;html=1;'
        cells.append('<mxCell id="zone_' + str(i) + '" value="' + _xesc(z['name']) + '" style="' + _xesc(st) + '" vertex="1" parent="1">' + geo(z['x'], z['y'], z['w'], z['h']) + '</mxCell>')
    for n in layout.get('nodes', []):
        nid = 'dn_' + _sid(n['id'])
        uri = _drawio_img(icons.get(n['id']))
        x, y, w, h = float(n['x']), float(n['y']), float(n['w']), float(n['h'])
        if uri:
            st = 'shape=image;verticalLabelPosition=bottom;verticalAlign=top;labelBackgroundColor=#ffffff;imageAspect=1;aspect=fixed;image=' + uri + ';'
            cells.append('<mxCell id="' + nid + '" value="' + _xesc(n.get('label') or n['id']) + '" style="' + _xesc(st) + '" vertex="1" parent="1">' + geo(x + w / 2 - 24, y + 6, 48, 48) + '</mxCell>')
        else:
            st = 'rounded=1;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=#9AA4B2;'
            cells.append('<mxCell id="' + nid + '" value="' + _xesc(n.get('label') or n['id']) + '" style="' + _xesc(st) + '" vertex="1" parent="1">' + geo(x, y, w, h) + '</mxCell>')
    for i, e in enumerate(layout.get('edges', [])):
        s = 'dn_' + _sid(e['from'])
        t = 'dn_' + _sid(e['to'])
        lbl = edge_labels.get(str(e.get('from')) + '|' + str(e.get('to'))) or ''
        st = 'edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;endArrow=block;strokeColor=#5b6770;'
        pts = e.get('points') or []
        way = ''
        if len(pts) > 2:
            way = '<Array as="points">' + ''.join('<mxPoint x="' + str(round(q[0], 1)) + '" y="' + str(round(q[1], 1)) + '"/>' for q in pts[1:-1]) + '</Array>'
        cells.append('<mxCell id="de_' + str(i) + '" value="' + _xesc(lbl) + '" style="' + _xesc(st) + '" edge="1" parent="1" source="' + s + '" target="' + t + '"><mxGeometry relative="1" as="geometry">' + way + '</mxGeometry></mxCell>')

    if doc:
        diagram_w = int(round(layout.get('width') or 800))
        diagram_h = int(round(layout.get('height') or 400))
        html = _doc_html_fragment(doc)
        st = 'text;html=1;align=left;verticalAlign=top;whiteSpace=wrap;rounded=1;fillColor=#FBFCFE;strokeColor=#dfe3e8;spacing=8;'
        cells.append('<mxCell id="doc_panel" value="' + _xesc(html) + '" style="' + _xesc(st) + '" vertex="1" parent="1">' +
                     geo(0, diagram_h + 30, max(560, diagram_w), 260) + '</mxCell>')

    model = '<mxGraphModel dx="1024" dy="768" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1600" pageHeight="1200" math="0" shadow="0"><root>' + ''.join(cells) + '</root></mxGraphModel>'
    return '<mxfile host="snowgram" type="device"><diagram name="' + _xesc(title or 'diagram') + '">' + model + '</diagram></mxfile>'


def _doc_html_fragment(doc):
    """Lightweight HTML used inside the draw.io text cell (draw.io supports html=1)."""
    out = []
    if doc.get('overview'):
        out.append('<b>Architecture Overview</b><br>' + _xesc(doc['overview']) + '<br><br>')
    comps = doc.get('components') or []
    if comps:
        out.append('<b>Component Summary</b><br>')
        for c in comps:
            out.append('&#8226; <b>' + _xesc(c.get('component') or '') + '</b> &#8212; ' + _xesc(c.get('role') or '') + '<br>')
        out.append('<br>')
    bps = doc.get('best_practices') or []
    if bps:
        out.append('<b>Best Practices</b><br>')
        for i, bp in enumerate(bps, 1):
            line = str(i) + '. ' + _xesc(bp.get('text') or '')
            su, st = bp.get('source_url'), bp.get('source_title')
            if su:
                line += ' [<a href="' + _xesc(su) + '">' + _xesc(st or 'source') + '</a>]'
            elif st:
                line += ' [' + _xesc(st) + ']'
            out.append(line + '<br>')
    srcs = _collect_sources(doc)
    if srcs:
        out.append('<br><b>Sources</b><br>')
        for i, sc in enumerate(srcs, 1):
            out.append(str(i) + '. <a href="' + _xesc(sc['url']) + '">' + _xesc(sc.get('title') or sc['url']) + '</a><br>')
    return ''.join(out)


# ---------------- Mermaid (diagram + visible documentation panel below) ----------------
def _wrapbr(s, n=64):
    s = '' if s is None else str(s)
    words, lines, cur = s.split(), [], ''
    for w in words:
        if len(cur) + len(w) + 1 <= n:
            cur = (cur + ' ' + w) if cur else w
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return '<br/>'.join(lines)


def _mermaid(layout, icons, edge_labels, title, doc):
    nodes = layout.get('nodes', [])
    zones = sorted(layout.get('zones', []), key=lambda z: float(z.get('x', 0)))
    zone_names = [z['name'] for z in zones] or sorted(set(n.get('zone', '') for n in nodes))
    by_zone = {}
    for n in nodes:
        by_zone.setdefault(n.get('zone', ''), []).append(n)
    for zn in by_zone:
        by_zone[zn].sort(key=lambda n: float(n.get('y', 0)))

    def node_line(n):
        # text-only labels: embedding base64 icons here blows Mermaid's maxTextSize.
        # Icons are present in the svg/html/drawio exports instead.
        return _sid(n['id']) + '["' + _mlabel(n.get('label') or n['id']) + '"]'

    inner = []
    real = [z for z in zone_names if z]
    if len(real) >= 2:
        for zn in zone_names:
            ns = by_zone.get(zn, [])
            if zn:
                inner.append('subgraph sg_' + _sid(zn) + '["' + _mlabel(zn) + '"]')
                for n in ns:
                    inner.append('  ' + node_line(n))
                inner.append('end')
            else:
                for n in ns:
                    inner.append(node_line(n))
    else:
        for n in nodes:
            inner.append(node_line(n))
    for e in layout.get('edges', []):
        s, t = _sid(e['from']), _sid(e['to'])
        lbl = edge_labels.get(str(e.get('from')) + '|' + str(e.get('to')))
        inner.append(s + (' -->|"' + _mlabel(lbl) + '"| ' if lbl else ' --> ') + t)

    if not doc:
        return '\\n'.join(['flowchart LR'] + ['  ' + x for x in inner])

    # doc present: frame the diagram (LR) and stack a Documentation panel below it (TB)
    L = ['flowchart TB', '  subgraph diagram_["' + _mlabel(title or 'Architecture') + '"]', '    direction LR']
    L += ['    ' + x for x in inner]
    L.append('  end')
    L.append('  subgraph docs_["Documentation"]')
    L.append('    direction TB')
    doc_ids = []
    clicks = []
    if doc.get('overview'):
        L.append('    docOverview["<b>Overview</b><br/>' + _wrapbr(_mlabel(doc['overview'])) + '"]')
        doc_ids.append('docOverview')
    comps = doc.get('components') or []
    if comps:
        cl = '<br/>'.join('&bull; <b>' + _mlabel(c.get('component') or '') + '</b> &mdash; ' + _mlabel(c.get('role') or '') for c in comps)
        L.append('    docComponents["<b>Component Summary</b><br/>' + cl + '"]')
        doc_ids.append('docComponents')
    for i, bp in enumerate(doc.get('best_practices') or [], 1):
        nid = 'docBP' + str(i)
        txt = '<b>' + str(i) + '.</b> ' + _wrapbr(_mlabel(bp.get('text') or ''))
        if bp.get('source_title'):
            txt += '<br/><i>Source: ' + _mlabel(bp['source_title']) + '</i>'
        L.append('    ' + nid + '["' + txt + '"]')
        doc_ids.append(nid)
        if bp.get('source_url'):
            clicks.append('  click ' + nid + ' "' + str(bp['source_url']).replace('"', '') + '" _blank')
    srcs = _collect_sources(doc)
    if srcs:
        sl = '<br/>'.join(str(i) + '. ' + _mlabel(sc.get('title') or sc['url']) + ' - ' + _mlabel(sc['url']) for i, sc in enumerate(srcs, 1))
        L.append('    docSources["<b>Sources</b><br/>' + sl + '"]')
        doc_ids.append('docSources')
    if len(doc_ids) >= 2:
        L.append('    ' + ' ~~~ '.join(doc_ids))
    L.append('  end')
    L.append('  diagram_ ~~~ docs_')
    L += clicks
    if doc_ids:
        L.append('  classDef docbox fill:#FBFCFE,stroke:#dfe3e8,color:#11162e;')
        L.append('  class ' + ','.join(doc_ids) + ' docbox;')
    return '\\n'.join(L)


# interactivity.css / interactivity.js are injected as _INTERACT_CSS / _INTERACT_JS
# at UDF deploy time (base64). Locally, fall back to reading the source files.
# The JS is sanitized so a literal "</script>" in its comments cannot terminate
# the inlined <script> early (that bug produced a wall of visible text).
try:
    _INTERACT_CSS
except NameError:
    try:
        import os as _os
        _h = _os.path.dirname(__file__) if '__file__' in globals() else '.'
        with open(_os.path.join(_h, 'diagram-interactivity', 'interactivity.css'), 'r') as _f:
            _INTERACT_CSS = _f.read()
    except Exception:
        _INTERACT_CSS = ''
try:
    _INTERACT_JS
except NameError:
    try:
        import os as _os2
        _h2 = _os2.path.dirname(__file__) if '__file__' in globals() else '.'
        with open(_os2.path.join(_h2, 'diagram-interactivity', 'interactivity.js'), 'r') as _f2:
            _INTERACT_JS = _f2.read().replace('</script', '<\\\\/script')
    except Exception:
        _INTERACT_JS = ''

# Snowflake logo data URIs injected at deploy; local fallback reads the SVG file.
# _LOGO_DATA_URI = color (for light/white surfaces: svg paper, draw.io canvas).
# _LOGO_WHITE_URI = transparent white variant (for the colored header in both themes).
try:
    _LOGO_DATA_URI
except NameError:
    try:
        import os as _ol, base64 as _bl
        _hl = _ol.path.dirname(__file__) if '__file__' in globals() else '.'
        with open(_ol.path.join(_hl, 'Snowflake Logo', 'Digital', 'SVG', 'snowflake-logo-color-rgb.svg'), 'rb') as _lf:
            _logo_raw = _lf.read()
        _LOGO_DATA_URI = 'data:image/svg+xml;base64,' + _bl.b64encode(_logo_raw).decode('ascii')
        _LOGO_WHITE_URI = 'data:image/svg+xml;base64,' + _bl.b64encode(
            _logo_raw.replace(b'#29b5e8', b'#ffffff').replace(b'#29B5E8', b'#ffffff')).decode('ascii')
    except Exception:
        _LOGO_DATA_URI = ''
        _LOGO_WHITE_URI = ''
try:
    _LOGO_WHITE_URI
except NameError:
    _LOGO_WHITE_URI = _LOGO_DATA_URI

# Theme variables (light default + dark override) + polished chrome. Placed AFTER
# the interactivity CSS so these win on shared vars (--accent/--connector-color/...).
_THEME_CSS = (
    ':root{--bg:#eef2f7;--fg:#16203a;--header-c1:#2aa3df;--header-c2:#1366b3;--header-grad:linear-gradient(120deg,var(--header-c1),var(--header-c2));'
    '--border:#dbe3ee;--panel-bg:#ffffff;--panel-fg:#16203a;--muted:#5b6678;--link:#1763c6;'
    '--paper:#f7f9fc;--node-bg:#ffffff;--node-border:#c9d4e3;--node-fg:#16203a;--zone-label:#5b6678;'
    '--legend-bg:#ffffff;--connector-color:#7587a0;--accent:#1763c6;--primary-hover:#e0820b;--container-color:#7C5CFC;--legacy-color:#C08A3E;--private-link-color:#2E9E4F;--data-share-color:#1763c6}'
    ':root[data-theme="dark"]{--bg:#070b18;--fg:#e8edf6;--header-c1:#0b5874;--header-c2:#0a1733;--header-grad:linear-gradient(120deg,var(--header-c1),var(--header-c2));'
    '--border:#23304f;--panel-bg:#0e1730;--panel-fg:#e8edf6;--muted:#93a0b8;--link:#7cc0ff;'
    '--paper:#0b1326;--node-bg:#13203c;--node-border:#26375c;--node-fg:#eef3fc;--zone-label:#aab8d4;'
    '--legend-bg:#0e1730;--connector-color:#8aa0b4;--accent:#6cb9ff;--primary-hover:#ffb454;--container-color:#a78bfa;--legacy-color:#d9a165;--private-link-color:#4CB963;--data-share-color:#6cb9ff}'
    'html,body{margin:0}'
    'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;'
    'background:var(--bg);color:var(--fg);transition:background .25s,color .25s}'
    '.app-header{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;'
    'padding:18px 28px;background:var(--header-grad);color:#fff}'
    '.app-header .title{margin:0;font-size:20px;font-weight:700;letter-spacing:.2px}'
    '.brand{display:flex;align-items:center;gap:14px;min-width:0}'
    '.brand-logo{height:26px;width:auto;display:block;flex:none}'
    '.app-header .meta{margin-top:5px;font-size:11px;color:rgba(255,255,255,.82);letter-spacing:.8px;text-transform:uppercase}'
    '.app-actions{display:flex;gap:8px;align-items:center}'
    'body.presenting .app-actions{opacity:0;pointer-events:none;transition:opacity .2s}'
    'body.presenting .app-header:hover .app-actions,body.presenting.chrome-reveal .app-actions{opacity:1;pointer-events:auto}'
    '.theme-toggle{cursor:pointer;border:1px solid rgba(255,255,255,.45);background:rgba(255,255,255,.10);'
    'color:#fff;border-radius:18px;padding:6px 14px;font-size:12.5px;white-space:nowrap}'
    '.theme-toggle:hover{background:rgba(255,255,255,.2)}'
    '.legend{display:flex;flex-wrap:wrap;gap:18px;padding:10px 28px;background:var(--legend-bg);'
    'border-bottom:1px solid var(--border);font-size:11.5px;color:var(--muted)}'
    '.legend .item{display:flex;align-items:center;gap:6px}'
    '.legend .sw{width:11px;height:11px;border-radius:3px;display:inline-block}'
    '.canvas{padding:26px;overflow:auto}'
    '.diagram-root{background:var(--paper);border:1px solid var(--border);border-radius:16px;'
    'box-shadow:0 12px 34px rgba(0,0,0,.28);margin:0 auto}'
    '.connectors{position:absolute;left:0;top:0;overflow:visible}'
    '.z-label{font-weight:700;font-size:11px;fill:var(--zone-label);letter-spacing:.8px}'
    '.b-rect{stroke:var(--accent-2)}.b-label{font-weight:800;font-size:11.5px;fill:var(--accent-2);letter-spacing:.9px}'
    '.b-sub{font-size:9px;fill:var(--accent-2);opacity:.75;letter-spacing:.3px}'
    '.container-rect{stroke:var(--container-color);stroke-width:1.75px;stroke-dasharray:5 3}.container-label{font-weight:700;font-size:10px;fill:var(--container-color);letter-spacing:.6px}'
    '.container-subtitle{font-size:8.5px;fill:var(--container-color);letter-spacing:.3px}'
    '.conn-arrow{fill:var(--connector-color)}'
    '.conn-arrow-gov{fill:var(--container-color)}.conn-arrow-leg{fill:var(--legacy-color)}'
    '.conn-arrow-plink{fill:var(--private-link-color)}.conn-arrow-dshare{fill:var(--data-share-color)}'
    '.connector-group.cat-governance .connector-path{stroke:var(--container-color);stroke-dasharray:1.5 3;opacity:.88}'
    '.connector-group.cat-legacy .connector-path{stroke:var(--legacy-color);stroke-dasharray:7 4;opacity:.88}'
    '.connector-group.cat-private_link .connector-path{stroke:var(--private-link-color);stroke-dasharray:none;opacity:.9}'
    '.connector-group.cat-data_share .connector-path{stroke:var(--data-share-color);stroke-width:2.2;stroke-dasharray:none;opacity:.95}'
    '.flow-node{position:absolute;box-sizing:border-box;background:var(--node-bg);border:1px solid var(--node-border);'
    'border-radius:12px;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:8px 7px;'
    'text-align:center;color:var(--node-fg);overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.18);'
    'transition:background .2s,border-color .2s,color .2s,box-shadow .2s}'
    '.flow-node img{width:38px;height:38px;margin-bottom:4px}'
    '.fn-title{font-weight:600;font-size:11.5px;line-height:1.15}'
    '.fn-sub{margin-top:2px;font-size:9.5px;line-height:1.1;color:var(--muted)}'
    '.fn-detail{margin-top:2px;font-size:9px;line-height:1.2;color:var(--muted);font-style:italic}'
    '.gateway-node{background:transparent;border:none;box-shadow:none;padding:8px 0 0 0;justify-content:flex-start}'
    '.gw-chip{width:32px;height:32px;border-radius:9px;background:rgba(41,181,232,.12);'
    'border:1.25px dashed var(--accent);display:flex;align-items:center;justify-content:center}'
    '.gw-chip img{width:22px;height:22px;margin-bottom:0}'
    '.gw-caption{margin-top:6px;font-size:9px;font-weight:600;line-height:1.15;color:var(--muted);text-align:center}'
    '.chip-node{background:transparent;border:none;box-shadow:none;padding:0;justify-content:flex-start}'
    '.chip-label{display:inline-flex;align-items:center;justify-content:center;height:30px;padding:0 12px;'
    'border-radius:15px;background:rgba(41,181,232,.12);border:1.25px solid var(--accent);'
    'font-size:10.5px;font-weight:700;white-space:nowrap}'
    '.doc-panel{max-width:1000px;width:100%;margin:22px auto 8px;background:var(--panel-bg);color:var(--panel-fg);'
    'border:1px solid var(--border);border-radius:16px;padding:22px 28px;line-height:1.55;box-sizing:border-box}'
    '.doc-panel h2{font-size:13px;text-transform:uppercase;letter-spacing:.8px;margin:18px 0 8px;color:var(--accent)}'
    '.doc-panel h2:first-child{margin-top:0}.doc-panel p{margin:4px 0}'
    '.doc-panel ul,.doc-panel ol{margin:6px 0;padding-left:22px}.doc-panel li{margin:5px 0}'
    '.doc-panel a{color:var(--link);text-decoration:none}.doc-panel a:hover{text-decoration:underline}'
    '.doc-panel .sources{list-style:none;padding-left:0}.doc-panel .sources li{margin:6px 0}'
    '.doc-panel .src-x{color:var(--muted);font-size:12px}'
    '.doc-panel li[data-node-ref]{cursor:pointer}.doc-panel li[data-node-ref]:hover{color:var(--accent)}'
    # --- tweaks ---
    '.doc-panel{box-shadow:0 12px 34px rgba(0,0,0,.28)}'  # (4) same shadow as diagram box
    # (3) tiles scale on hover; connectors only glow (no grow)
    '.flow-node{transition:transform .15s ease,box-shadow .15s ease,border-color .15s ease,background .2s,color .2s}'
    '.flow-node:hover,.flow-node.is-primary{transform:scale(1.06);z-index:5}'
    '.connector-group:hover .connector-path,.connector-group.is-active .connector-path{'
    'stroke:var(--accent);stroke-width:1.3;opacity:1;stroke-dasharray:none;animation:none;'
    'filter:drop-shadow(0 0 4px var(--accent))}'
    # (2) seamless dash loop: offset = 2x the 9px dash period (5+4), no visible restart
    '@keyframes connector-flow{from{stroke-dashoffset:0}to{stroke-dashoffset:-18}}'
    # connector animation speed is tunable (Motion section); overrides the base interactivity.css duration
    '.connector-path{animation-duration:var(--connector-dur,1.6s)}'
    # neighborhood hover-focus (overview): dim others, spotlight the node + its edges (matches reference deck)
    '.diagram-root.hovering .flow-node{opacity:.22;filter:grayscale(.5)}'
    '.diagram-root.hovering .flow-node.hl{opacity:1;filter:none;border-color:var(--accent);box-shadow:0 0 0 1.5px var(--accent),0 8px 26px rgba(41,181,232,.30)}'
    '.diagram-root.hovering .flow-node.hl-src{border-color:var(--primary-hover);box-shadow:0 0 0 2px var(--primary-hover),0 0 30px rgba(255,180,84,.55);transform:translateY(-3px) scale(1.06);z-index:7}'
    '.diagram-root.hovering .connector-group{opacity:.08}'
    '.diagram-root.hovering .connector-group.hl-edge{opacity:1}'
    '.diagram-root.hovering .connector-group.hl-edge .connector-path{stroke:var(--accent);stroke-width:2.6;opacity:1;stroke-dasharray:none;animation:none;filter:drop-shadow(0 0 6px var(--accent))}'
    # (7) minimal circular toggle (single glyph)
    '.theme-toggle{width:34px;height:34px;padding:0;border-radius:50%;font-size:15px;line-height:1;'
    'display:inline-flex;align-items:center;justify-content:center}'
    # ===== v2 chrome: modern type, gradient title, aurora bg, glass =====
    ':root{--font:"Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;'
    '--display:"Space Grotesk","Inter",sans-serif;'
    # canonical tunable set (driven by the Customize panel) — node typography/spacing/icon/motion/color
    '--font-title:var(--font);--font-sub:var(--font);--title-weight:700;--sub-weight:600;'
    '--title-size:11.5px;--sub-size:8.5px;--title-track:-.1px;--sub-track:.6px;--node-line:1.15;--title-gap:1px;'
    '--node-gap:10px;--node-px:13px;--icon-size:26px;--icon-pad:6px;--icon-radius:11px;'
    '--node-radius:16px;--connector-dur:1.6s;--accent-2:#29B5E8}'
    'html{background:var(--bg)}'
    # aurora runs in BOTH themes (matches the reference deck); body is transparent so html bg + aurora show through
    'body{font-family:var(--font);background:transparent}'
    'body::before{content:"";position:fixed;inset:-25% -12% -25% -12%;z-index:-1;pointer-events:none;'
    'background:radial-gradient(38% 34% at 18% 14%,rgba(41,181,232,.20),transparent 70%),'
    'radial-gradient(34% 30% at 82% 20%,rgba(113,211,220,.15),transparent 70%),'
    'radial-gradient(46% 42% at 62% 92%,rgba(23,99,198,.13),transparent 70%);'
    'filter:blur(22px);animation:sg-aurora 30s ease-in-out infinite alternate}'
    '@keyframes sg-aurora{0%{transform:translate3d(0,0,0) scale(1)}50%{transform:translate3d(-2.5%,2%,0) scale(1.06)}100%{transform:translate3d(2.5%,-1.5%,0) scale(1.03)}}'
    # display title: solid white in light (header is always blue); animated gradient shimmer in dark
    '.app-header .title{font-family:var(--display);font-weight:800;letter-spacing:-.3px}'
    ':root[data-theme="dark"] .app-header .title{'
    'background:linear-gradient(95deg,#d6f3ff 0%,#ffffff 28%,#7fd3ff 58%,#d6f3ff 100%);background-size:220% auto;'
    '-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent;'
    'animation:sg-titleshine 8s linear infinite}'
    '@keyframes sg-titleshine{to{background-position:220% center}}'
    # glassmorphism (dark theme only) on legend, doc panel, toggle
    ':root[data-theme="dark"] .legend{backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);'
    'background:color-mix(in srgb,var(--legend-bg) 70%,transparent)}'
    ':root[data-theme="dark"] .doc-panel{backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);'
    'background:color-mix(in srgb,var(--panel-bg) 80%,transparent)}'
    ':root[data-theme="dark"] .theme-toggle{backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}'
    # the diagram floats directly on the page (no floating card): drop paper bg/border/shadow
    '.diagram-root{background:transparent;border:none;box-shadow:none}'
    # ===== item 4: viewer breathing room =====
    '.canvas{padding:40px 40px 30px}'
    # ===== items 5/6: icon-left (wide) node + uppercase tracked subhead =====
    '.nodes-wide .flow-node{flex-direction:row;align-items:center;justify-content:flex-start;text-align:left;'
    'gap:var(--node-gap);padding:var(--node-px);border-radius:var(--node-radius);'
    'box-shadow:0 1px 2px rgba(10,30,60,.08),0 10px 24px rgba(10,30,60,.13),inset 0 1px 0 rgba(255,255,255,.10)}'
    '.nodes-wide .flow-node::before{content:"";position:absolute;left:0;right:0;top:0;height:3px;'
    'background:linear-gradient(90deg,var(--accent-2),rgba(113,211,220,.5),transparent);opacity:.85}'
    '.nodes-wide .fn-ico{flex:none;width:var(--icon-size);height:var(--icon-size);padding:var(--icon-pad);box-sizing:content-box;'
    'border-radius:var(--icon-radius);display:flex;align-items:center;justify-content:center;'
    'background:linear-gradient(135deg,color-mix(in srgb,var(--accent-2) 22%,transparent),color-mix(in srgb,var(--accent-2) 5%,transparent));box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--accent-2) 20%,transparent)}'
    '.nodes-wide .fn-ico img{width:100%;height:100%;margin:0;object-fit:contain}'
    '.nodes-wide .fn-text{display:flex;flex-direction:column;min-width:0;gap:var(--title-gap)}'
    '.nodes-wide .fn-title{font-family:var(--font-title);font-weight:var(--title-weight);font-size:var(--title-size);'
    'line-height:var(--node-line);letter-spacing:var(--title-track);color:var(--node-fg)}'
    '.nodes-wide .fn-sub{margin:0;font-family:var(--font-sub);font-weight:var(--sub-weight);font-size:var(--sub-size);'
    'line-height:1.2;color:var(--muted);text-transform:uppercase;letter-spacing:var(--sub-track)}'
    # A type line that merely echoes the title (e.g. "Azure Synapse"/"AZURE SYNAPSE")
    # is hidden by default (sg-echo, set server-side + kept live by sgTypeEcho).
    # The Customize toggle "Repeat type label..." flips body.sg-show-types to reveal
    # them all. Informative type lines (SNOWFLAKE ACCOUNT, DYNAMIC TABLE) never get
    # sg-echo, so they always show.
    '.nodes-wide .fn-sub.sg-echo{display:none}'
    'body.sg-show-types .nodes-wide .fn-sub.sg-echo{display:block}'
    # The interactive HTML always renders in wide mode, so ".nodes-wide
    # .flow-node" above (flex-direction:row, align-items:center) has equal
    # specificity to -- and comes AFTER, so silently overrides -- the plain
    # ".chip-node"/".gateway-node" rules earlier in this file. Found via
    # direct DOM bounding-box check (2026-09-09): the chip label sat 20px
    # from its box's top in the HTML export while the SVG export (which has
    # no wide-mode override) correctly sat flush at 0 -- an HTML/SVG/PDF
    # drift the router's port math can't see. Re-assert column-direction +
    # top alignment for these two styles specifically, matching-specificity
    # selectors placed LAST so they win regardless of narrow/wide mode.
    '.nodes-wide .chip-node{flex-direction:column;align-items:center;justify-content:flex-start;'
    'text-align:center;gap:0;padding:0}'
    '.nodes-wide .gateway-node{flex-direction:column;align-items:center;justify-content:flex-start;'
    'text-align:center;gap:0;padding:8px 0 0 0}'
    '.nodes-wide .chip-node::before,.nodes-wide .gateway-node::before{content:none}'
)

_THEME_INIT = (
    "<script>(function(){var K='snowgram-theme',r=document.documentElement;"
    "function lbl(t){return t==='dark'?String.fromCharCode(9728):String.fromCharCode(9790);}"
    "function ap(t){r.setAttribute('data-theme',t);var b=document.getElementById('themeToggle');if(b)b.textContent=lbl(t);}"
    "var s=null;try{s=localStorage.getItem(K);}catch(e){}"
    "var init=s||((window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches)?'dark':'light');ap(init);"
    "document.addEventListener('DOMContentLoaded',function(){ap(r.getAttribute('data-theme')||init);"
    "var b=document.getElementById('themeToggle');if(b)b.addEventListener('click',function(){"
    "var t=r.getAttribute('data-theme')==='dark'?'light':'dark';ap(t);try{localStorage.setItem(K,t);}catch(e){}});});})();</script>"
)

_CAT_LABEL = {'snow': 'Snowflake', 'onprem': 'External', 'bridge': 'Connector', 'outcome': 'Consumer', 'default': 'Other'}


def _collect_sources(doc):
    """Deduped citations list (by url) from doc.citations + best_practices sources."""
    seen, out = set(), []
    for c in (doc.get('citations') or []):
        u = c.get('url')
        if u and u not in seen:
            seen.add(u)
            out.append({'url': u, 'title': c.get('title') or u, 'excerpt': c.get('excerpt')})
    for bp in (doc.get('best_practices') or []):
        u = bp.get('source_url')
        if u and u not in seen:
            seen.add(u)
            out.append({'url': u, 'title': bp.get('source_title') or u, 'excerpt': None})
    return out


def _norm(s):
    s = (s or '').lower()
    return ' '.join(''.join(ch if ch.isalnum() else ' ' for ch in s).split())


def _type_echoes(ctype, label):
    # A type "eyebrow" is redundant when its canonical name already appears as a
    # whole-word phrase INSIDE the label -- "Bronze Dynamic Table"/"DYNAMIC TABLE",
    # "Azure Synapse"/"AZURE SYNAPSE", "Power BI (Legacy)"/"POWER BI",
    # "Streamlit / React App"/"STREAMLIT". Space-padded so it matches whole words
    # only ("sql" won't match inside "mysql"), and it subsumes exact equality.
    # Only type-IN-label (not the reverse): a type that adds info beyond the label
    # -- "Arcadia Health (Snowflake)"/"SNOWFLAKE ACCOUNT", "Snowflake Horizon"/
    # "GOVERNANCE" -- is NOT an echo and stays shown.
    ct = _norm(ctype)
    return bool(ct) and (' ' + _norm(label) + ' ').find(' ' + ct + ' ') >= 0


def _match_node(name, node_idx):
    """Map a component-summary name to a diagram node id. Tolerant: exact normalized
    match, then substring containment, then token overlap (>=0.5). node_idx=[(norm,id)]."""
    nn = _norm(name)
    if not nn or not node_idx:
        return None
    for nl, i in node_idx:
        if nl and nl == nn:
            return i
    best, blen = None, -1
    for nl, i in node_idx:
        if nl and (nl in nn or nn in nl) and len(nl) > blen:
            best, blen = i, len(nl)
    if best:
        return best
    nt = set(nn.split())
    best, bscore = None, 0.0
    for nl, i in node_idx:
        t = set(nl.split())
        if not t:
            continue
        inter = len(nt & t)
        score = inter / float(len(t))
        if inter >= 1 and score >= 0.5 and score > bscore:
            best, bscore = i, score
    return best


def _doc_html_panel(doc, node_idx=None):
    if not doc:
        return ''
    node_idx = node_idx or []
    out = ['<div class="doc-panel">']
    if doc.get('overview'):
        out.append('<h2>Architecture Overview</h2><p>' + _xesc(doc['overview']) + '</p>')
    comps = doc.get('components') or []
    if comps:
        out.append('<h2>Component Summary</h2><ul>')
        for c in comps:
            name = c.get('component') or ''
            ref = _match_node(name, node_idx)
            attr = (' data-node-ref="' + _xesc(ref) + '"') if ref else ''
            out.append('<li' + attr + '><b>' + _xesc(name) + '</b> &mdash; ' + _xesc(c.get('role') or '') + '</li>')
        out.append('</ul>')
    bps = doc.get('best_practices') or []
    if bps:
        out.append('<h2>Best Practices</h2><ol>')
        for bp in bps:
            li = '<li>' + _xesc(bp.get('text') or '')
            su, st = bp.get('source_url'), bp.get('source_title')
            if su:
                li += ' [<a href="' + _xesc(su) + '" target="_blank" rel="noopener">' + _xesc(st or 'source') + '</a>]'
            elif st:
                li += ' [' + _xesc(st) + ']'
            out.append(li + '</li>')
        out.append('</ol>')
    srcs = _collect_sources(doc)
    if srcs:
        out.append('<h2>Sources</h2><ul class="sources">')
        for sc in srcs:
            li = '<li><a href="' + _xesc(sc['url']) + '" target="_blank" rel="noopener">' + _xesc(sc['title']) + '</a>'
            if sc.get('excerpt'):
                li += ' <span class="src-x">&mdash; ' + _xesc(sc['excerpt']) + '</span>'
            out.append(li + '</li>')
        out.append('</ul>')
    out.append('</div>')
    return ''.join(out)


_PANEL_CSS = (
    # tuner range value readout (label holds the control name + current value)
    '.tp-row label{display:flex;justify-content:space-between;align-items:baseline;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.4px;font-size:9.5px;margin-bottom:3px}'
    '.tp-row label b{color:var(--accent-2);font-variant-numeric:tabular-nums;font-size:11px;text-transform:none;letter-spacing:0}'
    # settings gate + editable affordance
    '.brand-logo-wrap{position:relative;display:inline-flex;align-items:center;cursor:pointer;border-radius:6px}'
    # subtle gear sits just right of the wordmark (never overlaps it); brightens on hover/active
    '.brand-gear{position:absolute;left:100%;top:50%;transform:translateY(-50%);margin-left:2px;'
    'font-size:11px;line-height:1;color:rgba(255,255,255,.55);pointer-events:none;transition:color .2s,opacity .2s;opacity:1}'
    '.brand-logo-wrap:hover .brand-gear{color:rgba(255,255,255,.92);opacity:1}'
    # one-shot pulse: fires on load and on hover via the .pulse class (added by JS), so it never loops
    '.brand-logo-wrap::before{content:"";position:absolute;inset:-4px;border-radius:9px;pointer-events:none;box-shadow:0 0 0 0 rgba(255,255,255,0)}'
    '.brand-logo-wrap.pulse::before{animation:sg-logopulse 2s ease-out 1}'
    '@keyframes sg-logopulse{0%{box-shadow:0 0 0 0 rgba(255,255,255,.45)}70%{box-shadow:0 0 0 9px rgba(255,255,255,0)}100%{box-shadow:0 0 0 0 rgba(255,255,255,0)}}'
    'body.settings-on .brand-logo-wrap{outline:2px solid rgba(255,255,255,.85);outline-offset:3px}'
    'body.settings-on .brand-gear{color:var(--accent-2);opacity:1}'
    'body.settings-on [data-edit-id]{position:relative;cursor:text;border-radius:4px;outline:1px dashed color-mix(in srgb,var(--accent-2) 55%,transparent);outline-offset:2px;transition:outline-color .15s,background .15s}'
    'body.settings-on [data-edit-id]:hover{outline-style:solid;outline-color:var(--accent-2);background:color-mix(in srgb,var(--accent-2) 12%,transparent)}'
    'body.settings-on [data-edit-id]:hover::after{content:"";position:absolute;top:-5px;right:-5px;width:8px;height:8px;border-radius:50%;background:var(--accent-2);box-shadow:0 0 0 2px var(--panel-bg);pointer-events:none}'
    '[data-edit-id].editing,body.settings-on [data-edit-id][contenteditable="true"]{outline:2px solid var(--accent-2);background:color-mix(in srgb,var(--accent-2) 14%,transparent)}'
    'body.settings-on [data-edit-id][contenteditable="true"]::after{display:none}'
    # edit-mode ribbon + viewport frame
    '#editRibbon{position:fixed;top:14px;left:50%;transform:translateX(-50%) translateY(-12px);z-index:60;display:none;align-items:center;gap:8px;padding:8px 16px;border-radius:999px;font-family:var(--display);font-size:12.5px;font-weight:600;color:var(--panel-fg);background:color-mix(in srgb,var(--panel-bg) 80%,transparent);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border:1px solid color-mix(in srgb,var(--accent-2) 55%,var(--border));box-shadow:0 8px 26px rgba(0,0,0,.22);opacity:0;transition:opacity .25s,transform .25s}'
    '#editRibbon em{font-style:normal;font-weight:400;color:var(--muted)}'
    '#editRibbon .er-ico{color:var(--accent-2);font-size:14px;line-height:1}'
    'body.settings-on #editRibbon{display:flex;opacity:1;transform:translateX(-50%) translateY(0)}'
    '#editRibbon{overflow:visible}'
    '.er-card{position:absolute;left:50%;top:100%;z-index:-1;cursor:pointer;transform:translate(-50%,-78%);opacity:0;padding:7px 16px 8px;border:none;border-radius:0 0 14px 14px;font-family:var(--display);font-size:12px;font-weight:700;letter-spacing:.3px;color:#fff;background:var(--accent-2);box-shadow:0 8px 18px rgba(0,0,0,.28);transition:transform .25s ease,opacity .2s ease}'
    '#editRibbon:hover .er-card,#editRibbon:focus-within .er-card{transform:translate(-50%,86%);opacity:1}'
    '.er-card:hover{filter:brightness(1.08)}'
    'body.settings-on::after{content:"";position:fixed;inset:0;z-index:40;pointer-events:none;border:2px solid color-mix(in srgb,var(--accent-2) 45%,transparent);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--accent-2) 18%,transparent)}'
    # rich-text toolbar (bold/italic/underline/strike)
    '#rtBar{position:fixed;z-index:62;display:none;gap:2px;padding:4px;border-radius:9px;background:var(--panel-bg);border:1px solid var(--border);box-shadow:0 6px 20px rgba(0,0,0,.28)}'
    '#rtBar.show{display:flex}'
    '#rtBar button{cursor:pointer;width:28px;height:28px;padding:0;border:1px solid transparent;border-radius:6px;background:transparent;color:var(--panel-fg);font-size:13px;line-height:1}'
    '#rtBar button:hover{background:color-mix(in srgb,var(--accent-2) 16%,transparent)}'
    '#rtBar button:active{background:color-mix(in srgb,var(--accent-2) 28%,transparent)}'
    # cover slide
    '#pkCover{position:fixed;inset:0;z-index:45;display:none;align-items:center;justify-content:center;text-align:center;background:var(--header-grad);color:#fff}'
    '#pkCover.show{display:flex}'
    '.pk-cover-inner{display:flex;flex-direction:column;align-items:center;gap:22px;padding:6vh 8vw}'
    '.pk-cover-mark{height:56px;width:auto}'
    '.pk-cover-rule{width:90px;height:3px;border-radius:2px;background:rgba(255,255,255,.6)}'
    '.pk-cover-presented{font-family:var(--display);font-size:13px;letter-spacing:3px;text-transform:uppercase;opacity:.85}'
    '.pk-cover-customer{display:flex;flex-direction:column;align-items:center;gap:16px}'
    '#pkCoverLogo{max-height:96px;max-width:60vw;width:auto}'
    '.pk-cover-name{font-family:var(--display);font-weight:700;font-size:clamp(28px,6vw,64px);line-height:1.1}'
    '.pk-cover-meta{display:flex;flex-direction:column;align-items:center;gap:6px;margin-top:6px}'
    '.pk-cover-presenter{font-family:var(--display);font-size:clamp(15px,2.2vw,22px);font-weight:600}'
    '.pk-cover-date{font-size:clamp(12px,1.6vw,16px);opacity:.8;letter-spacing:.5px}'
    'body.settings-on .pk-cover-meta [data-edit-id]:empty::before{content:attr(data-ph);opacity:.55}'
    'body.presenting .pk-cover-meta [data-edit-id]:empty{display:none}'
    '#coverNav{position:fixed;left:18px;bottom:22px;z-index:56;display:none;cursor:pointer;border:1px solid var(--border);border-radius:999px;padding:8px 14px;font-size:12.5px;font-weight:600;background:color-mix(in srgb,var(--panel-bg) 86%,transparent);color:var(--panel-fg);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);box-shadow:0 6px 20px rgba(0,0,0,.25)}'
    '#coverNav:hover{border-color:var(--accent-2)}'
    'body.cover-enabled:not(.presenting) #coverNav{display:block}'
    # docked translucent tuner panel
    '#tunePanel{position:fixed;top:0;right:0;height:100vh;width:330px;z-index:60;transform:translateX(100%);'
    'transition:transform .28s ease;display:flex;flex-direction:column;color:var(--panel-fg);'
    'background:color-mix(in srgb,var(--panel-bg) 22%,transparent);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);'
    'border-left:1px solid var(--border);box-shadow:-8px 0 30px rgba(0,0,0,.25)}'
    '#tunePanel.open{transform:translateX(0)}'
    '#tunePanel .tp-head,#tunePanel .tp-body,#tunePanel .tp-foot{opacity:.5;transition:opacity .2s}'
    '#tunePanel:hover .tp-head,#tunePanel:focus-within .tp-head,#tunePanel:hover .tp-body,#tunePanel:focus-within .tp-body,#tunePanel:hover .tp-foot,#tunePanel:focus-within .tp-foot{opacity:1}'
    '.tp-head{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid var(--border);font-family:var(--display);font-weight:700}'
    '.tp-body{padding:8px 14px;overflow:auto;flex:1}'
    '.tp-foot{padding:12px 14px;border-top:1px solid var(--border);display:flex;flex-direction:column;gap:8px}'
    '.tp-sec{margin:10px 0 4px}'
    '.tp-sec>summary{cursor:pointer;list-style:none;font-family:var(--display);font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--accent-2);padding:5px 0;border-bottom:1px dashed var(--border);user-select:none}'
    '.tp-sec>summary::-webkit-details-marker{display:none}'
    '.tp-sec[open]>summary{margin-bottom:4px}'
    '.tp-row{margin:8px 0}'
    '.tp-row input[type=range]{-webkit-appearance:none;appearance:none;width:100%;height:16px;margin:0;background:transparent;cursor:pointer}'
    '.tp-row input[type=range]::-webkit-slider-runnable-track{height:4px;border-radius:2px;background:color-mix(in srgb,var(--accent-2) 35%,var(--border))}'
    '.tp-row input[type=range]::-moz-range-track{height:4px;border-radius:2px;background:color-mix(in srgb,var(--accent-2) 35%,var(--border))}'
    '.tp-row input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;margin-top:-5px;width:13px;height:13px;border-radius:50%;background:var(--accent-2);border:2px solid var(--panel-bg);box-shadow:0 1px 3px rgba(0,0,0,.3)}'
    '.tp-row input[type=range]::-moz-range-thumb{width:13px;height:13px;border:2px solid var(--panel-bg);border-radius:50%;background:var(--accent-2);box-shadow:0 1px 3px rgba(0,0,0,.3)}'
    '.tp-row input[type=range]:focus{outline:none}'
    '.tp-row input[type=range]:hover::-webkit-slider-thumb,.tp-row input[type=range]:focus::-webkit-slider-thumb{box-shadow:0 0 0 4px color-mix(in srgb,var(--accent-2) 25%,transparent)}'
    '.tp-row select{width:100%;background:var(--panel-bg);color:var(--panel-fg);border:1px solid var(--border);border-radius:6px;padding:5px 6px;font-size:11px}'
    '.tp-row input[type=color]{width:100%;height:26px;background:transparent;border:1px solid var(--border);border-radius:6px;padding:2px;cursor:pointer}'
    '.tp-colorhex{display:flex;gap:6px;align-items:center}'
    '.tp-colorhex input[type=color]{flex:none;width:30px;height:26px;padding:2px;border:1px solid var(--border);border-radius:6px;background:transparent;cursor:pointer}'
    '.tp-colorhex input[type=text]{flex:1;min-width:0;font-family:ui-monospace,Menlo,monospace;font-size:11px;background:var(--panel-bg);color:var(--panel-fg);border:1px solid var(--border);border-radius:6px;padding:5px 7px}'
    '.tp-colorhex input[type=text].bad{border-color:#e0533d;color:#e0533d}'
    '.tp-clear{margin-top:6px;cursor:pointer;font-size:11px;padding:5px 9px;border:1px solid var(--border);border-radius:7px;background:transparent;color:var(--panel-fg)}'
    '.tp-clear:hover{border-color:var(--accent-2)}'
    '.tp-btn{cursor:pointer;border:1px solid var(--border);background:var(--accent-2);color:#fff;border-radius:8px;padding:8px 12px;font-size:12.5px;font-weight:600}'
    '.tp-btn.sec{background:transparent;color:var(--panel-fg)}'
    '.tp-foot input[type=text]{background:var(--panel-bg);color:var(--panel-fg);border:1px solid var(--border);border-radius:6px;padding:6px 8px;font-size:12px}'
    '.tp-save{display:flex;gap:8px;align-items:center}.tp-save input{flex:1;min-width:0}.tp-save .tp-btn{flex:none}'
    '.tp-hint{font-size:9.5px;color:var(--muted);margin:2px 0 0;line-height:1.4}'
    '#tuneClose{cursor:pointer;background:none;border:none;color:var(--panel-fg);font-size:20px;line-height:1;padding:0 4px}#tuneClose:hover{color:var(--accent-2)}'
    '.tp-btnrow{display:flex;gap:8px}.tp-btnrow .tp-btn{flex:1}'
    '#tuneDump{width:100%;height:60px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:10px;line-height:1.35;'
    'background:var(--panel-bg);color:var(--muted);border:1px solid var(--border);border-radius:6px;padding:6px;box-sizing:border-box;resize:none}'
    # vertical CUSTOMIZE tab
    '#tuneTab{position:fixed;right:0;bottom:26px;z-index:55;display:none;cursor:pointer;border:none;'
    'writing-mode:vertical-rl;padding:14px 7px;border-radius:8px 0 0 8px;'
    'background:var(--accent-2);color:#fff;font-size:11.5px;font-weight:700;letter-spacing:1px}'
    'body.settings-on #tuneTab{display:block}'
    'body.settings-on #tunePanel.open ~ #tuneTab{display:none}'
    # present mode + caption bar
    '.present-btn{cursor:pointer;border:1px solid rgba(255,255,255,.45);background:rgba(255,255,255,.10);color:#fff;'
    'border-radius:18px;padding:6px 14px;font-size:12.5px;white-space:nowrap}'
    '.present-btn:hover{background:rgba(255,255,255,.2)}'
    '.flow-node,.connector-group{transition:opacity .35s ease,transform .35s ease}'
    'body.presenting .flow-node[data-hidden="1"]{opacity:0;transform:scale(.96);pointer-events:none}'
    'body.presenting .connector-group[data-hidden="1"]{opacity:0}'
    '#capBar{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:58;max-width:760px;width:calc(100% - 48px);'
    'display:none;align-items:center;gap:14px;padding:14px 18px;border-radius:14px;color:var(--panel-fg);'
    'background:color-mix(in srgb,var(--panel-bg) 72%,transparent);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);'
    'border:1px solid var(--border);box-shadow:0 12px 34px rgba(0,0,0,.3)}'
    'body.presenting #capBar{display:flex}'
    '#capBar .cap-step{font-family:var(--display);font-weight:700;color:var(--accent);font-size:13px;white-space:nowrap}'
    '#capBar .cap-title{font-weight:700;font-size:13.5px}'
    '#capBar .cap-text{font-size:12.5px;color:var(--muted);line-height:1.4}'
    '#capBar .cap-nav{margin-left:auto;display:flex;gap:6px}'
    '#capBar .cap-nav button{cursor:pointer;border:1px solid var(--border);background:var(--panel-bg);color:var(--panel-fg);border-radius:8px;padding:6px 10px;font-size:13px}'
)

_PANEL_MARKUP = (
    '<aside id="tunePanel" aria-label="Customize">'
    '<div class="tp-head"><span>Customize</span><button id="tuneClose" type="button" title="Close" aria-label="Close">&times;</button></div>'
    '<div class="tp-body" id="tuneRows"></div>'
    '<div class="tp-foot"><div class="tp-save"><input id="saveName" type="text" value="snowgram-diagram-edited.html"/>'
    '<button class="tp-btn" id="tuneSave" type="button">Save</button></div>'
    '<div class="tp-btnrow"><button class="tp-btn sec" id="tuneReset" type="button">Reset</button>'
    '<button class="tp-btn sec" id="tuneCopy" type="button">Copy CSS</button></div>'
    '<p class="tp-hint">Click Customize to enter/exit settings. Save writes a new self-contained HTML copy with your text edits + style changes baked in.</p>'
    '<textarea id="tuneDump" readonly spellcheck="false" aria-label="CSS overrides"></textarea></div></aside>'
    '<button id="tuneTab" type="button">CUSTOMIZE</button>'
    '<div id="editRibbon" aria-hidden="true"><span class="er-ico">&#9998;</span> Edit mode <em>&mdash; click any text to edit, or open Customize to restyle</em><button id="ribbonPresent" class="er-card" type="button">&#9654; Present</button></div>'
    '<div id="rtBar" role="toolbar" aria-label="Text format" aria-hidden="true"><button type="button" data-rt="bold" title="Bold"><b>B</b></button><button type="button" data-rt="italic" title="Italic"><i>I</i></button><button type="button" data-rt="underline" title="Underline"><u>U</u></button><button type="button" data-rt="strikeThrough" title="Strikethrough"><s>S</s></button></div>'
    '<div id="capBar"><span class="cap-step"></span><div><div class="cap-title"></div><div class="cap-text"></div></div>'
    '<div class="cap-nav"><button data-cap="prev" type="button">Prev</button>'
    '<button data-cap="next" type="button">Next</button><button data-cap="exit" type="button">Show all</button></div></div>'
)

_PANEL_JS = (
    "(function(){var r=document.documentElement,body=document.body;"
    "var EDITS=(window.__SAVED_EDITS||{});window.__SG_EDITS=function(){return EDITS;};"
    "function applyEdits(scope){(scope||document).querySelectorAll('[data-edit-id]').forEach(function(el){"
    "var id=el.getAttribute('data-edit-id');if(Object.prototype.hasOwnProperty.call(EDITS,id))el.innerHTML=EDITS[id];});}"
    # Self-hiding type line: hide a card's type eyebrow when its text appears as a
    # whole-word phrase inside the title (mirrors the server-side _type_echoes).
    # Runs on load AND after every edit (see commit), so renaming a title live
    # re-reveals/re-hides the type.
    "function sgNorm(s){return (s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();}"
    "function sgTypeEcho(){document.querySelectorAll('.flow-node').forEach(function(n){var t=n.querySelector('.fn-title'),s=n.querySelector('.fn-sub');if(!s)return;var se=sgNorm(s.textContent),te=sgNorm(t?t.textContent:'');s.classList.toggle('sg-echo',!!se&&(' '+te+' ').indexOf(' '+se+' ')>=0);});}"
    "function setSettings(on){body.classList.toggle('settings-on',!!on);if(on)exitPresent();"
    "if(!on){var p=document.getElementById('tunePanel');if(p)p.classList.remove('open');}}"
    "var logo=document.getElementById('brandLogo');"
    "if(logo)logo.addEventListener('click',function(){if(body.classList.contains('presenting')){body.classList.toggle('chrome-reveal');}else{setSettings(!body.classList.contains('settings-on'));}});"
    "if(logo){logo.addEventListener('animationend',function(){logo.classList.remove('pulse');});"
    "function sgpulse(){logo.classList.remove('pulse');void logo.offsetWidth;logo.classList.add('pulse');}"
    "logo.addEventListener('mouseenter',sgpulse);sgpulse();}"
    "var cbtn=document.getElementById('customizeBtn');"
    "if(cbtn)cbtn.addEventListener('click',function(){var on=!body.classList.contains('settings-on');setSettings(on);var p=document.getElementById('tunePanel');if(p){if(on)p.classList.add('open');else p.classList.remove('open');}});"
    "var coverWanted=false,onCover=false;"
    "function syncCoverChrome(){body.classList.toggle('cover-enabled',coverWanted);var nb=document.getElementById('coverNav');if(nb)nb.textContent=onCover?'Architecture →':'← Cover';}"
    "function gotoCover(){onCover=true;var c=document.getElementById('pkCover');if(c)c.classList.add('show');syncCoverChrome();}"
    "function gotoArch(){onCover=false;var c=document.getElementById('pkCover');if(c)c.classList.remove('show');syncCoverChrome();}"
    "function coverEnable(v){coverWanted=!!v;if(coverWanted)gotoCover();else gotoArch();}"
    "function coverEnabled(){return coverWanted;}"
    "function coverSetLogo(url){var img=document.getElementById('pkCoverLogo');var c=document.getElementById('pkCover');var nm=c?c.querySelector('.pk-cover-name'):null;if(!img)return;if(url){img.src=url;img.hidden=false;if(nm)nm.style.display='none';}else{img.removeAttribute('src');img.hidden=true;if(nm)nm.style.display='';}}"
    "var FONTS=[['Inter','Inter,sans-serif'],['Space Grotesk','Space Grotesk,Inter,sans-serif'],"
    "['Manrope','Manrope,sans-serif'],['Sora','Sora,sans-serif'],"
    "['IBM Plex Sans','IBM Plex Sans,sans-serif'],['IBM Plex Mono','IBM Plex Mono,monospace'],"
    "['Lora','Lora,Georgia,serif'],['System','system-ui,-apple-system,sans-serif'],"
    "['Georgia','Georgia,Times New Roman,serif']];"
    "var SECTIONS=[['Typography',["
    "{k:'display',t:'select',label:'Headings font',opts:FONTS,def:'Space Grotesk,Inter,sans-serif'},"
    "{k:'font',t:'select',label:'Body font',opts:FONTS,def:'Inter,sans-serif'},"
    "{k:'font-title',t:'select',label:'Node title font',opts:FONTS,def:'Inter,sans-serif'},"
    "{k:'font-sub',t:'select',label:'Node sub font',opts:FONTS,def:'Inter,sans-serif'},"
    "{k:'title-weight',t:'range',label:'Title weight',min:400,max:800,step:50,def:700},"
    "{k:'sub-weight',t:'range',label:'Sub weight',min:400,max:800,step:50,def:600},"
    "{k:'title-size',t:'range',label:'Title size',min:8,max:18,step:0.5,def:11.5,unit:'px'},"
    "{k:'sub-size',t:'range',label:'Subheading size',min:6,max:13,step:0.5,def:8.5,unit:'px'},"
    "{k:'title-track',t:'range',label:'Title letter-spacing',min:-1,max:2,step:0.05,def:-0.1,unit:'px'},"
    "{k:'sub-track',t:'range',label:'Sub letter-spacing',min:0,max:1.5,step:0.05,def:0.6,unit:'px'},"
    "{k:'node-line',t:'range',label:'Title line-height',min:1,max:1.6,step:0.05,def:1.15},"
    "{k:'show-type-echoes',t:'toggle',label:'Repeat type label when it matches the title',def:false,init:function(){return document.body.classList.contains('sg-show-types');},on:function(v){document.body.classList.toggle('sg-show-types',!!v);}}]],"
    "['Spacing',["
    "{k:'title-gap',t:'range',label:'Title → sub gap',min:-6,max:8,step:0.5,def:1,unit:'px'},"
    "{k:'node-gap',t:'range',label:'Icon → text gap',min:4,max:20,step:0.5,def:10,unit:'px'},"
    "{k:'node-px',t:'range',label:'Node h-padding',min:6,max:24,step:0.5,def:13,unit:'px'}]],"
    "['Icon',["
    "{k:'icon-size',t:'range',label:'Icon size',min:14,max:40,step:1,def:26,unit:'px'},"
    "{k:'icon-pad',t:'range',label:'Icon padding',min:2,max:12,step:0.5,def:6,unit:'px'},"
    "{k:'icon-radius',t:'range',label:'Icon radius',min:4,max:18,step:1,def:11,unit:'px'}]],"
    "['Node',[{k:'node-radius',t:'range',label:'Node radius',min:6,max:22,step:1,def:16,unit:'px'}]],"
    "['Motion',[{k:'connector-dur',t:'range',label:'Connector speed',min:0.6,max:3,step:0.1,def:1.6,unit:'s'}]],"
    "['Background',["
    "{k:'bg',t:'colorhex',label:'Page background',def:'#eef2f7'},"
    "{k:'header-c1',t:'colorhex',label:'Header color 1',def:'#2aa3df'},"
    "{k:'header-c2',t:'colorhex',label:'Header color 2',def:'#1366b3'},"
    "{k:'paper',t:'colorhex',label:'Diagram canvas',def:'#f7f9fc'},"
    "{k:'accent-2',t:'colorhex',label:'Accent',def:'#29B5E8'}]],"
    "['Cover',["
    "{k:'cover-on',t:'toggle',label:'Show cover slide',def:false,init:function(){var c=document.getElementById('pkCover');return !!(c&&c.classList.contains('show'));},on:function(v){coverEnable(v);}},"
    "{k:'cover-logo',t:'file',label:'Customer logo (SVG / PNG)',accept:'image/*',on:function(u){coverSetLogo(u);},onreset:function(){coverSetLogo('');}}]]];"
    "function cssVal(k){return getComputedStyle(r).getPropertyValue('--'+k).trim();}"
    "function setVar(k,v,u){r.style.setProperty('--'+k,(u?(v+u):v));}"
    "function toHex(c){c=(c||'').trim();if(c.charAt(0)==='#')return c;var m=c.match(/[0-9]+/g);"
    "if(m&&m.length>=3){return '#'+m.slice(0,3).map(function(n){n=parseInt(n,10);var h=n.toString(16);return h.length<2?('0'+h):h;}).join('');}return '#29B5E8';}"
    "function normHex(c){c=(c||'').trim();if(c.charAt(0)!=='#')return null;var h=c.slice(1);if(!/^[0-9a-fA-F]+$/.test(h))return null;if(h.length===3)h=h.charAt(0)+h.charAt(0)+h.charAt(1)+h.charAt(1)+h.charAt(2)+h.charAt(2);if(h.length!==6&&h.length!==8)return null;return '#'+h.toLowerCase();}"
    "var TKEYS=['display','font','font-title','font-sub','title-weight','sub-weight','title-size','sub-size','title-track','sub-track','node-line','title-gap','node-gap','node-px','icon-size','icon-pad','icon-radius','node-radius','connector-dur','accent-2','bg','header-c1','header-c2','paper'];"
    "var CTRLS=[];"
    "function dump(){var t=document.getElementById('tuneDump');if(!t)return;t.value=CTRLS.filter(function(c){return !c.novar;}).map(function(c){return '--'+c.k+':'+c.get()+';';}).join(String.fromCharCode(10));}"
    "function buildTuner(){var host=document.getElementById('tuneRows');if(!host)return;host.innerHTML='';CTRLS=[];"
    "SECTIONS.forEach(function(sec){var d=document.createElement('details');d.className='tp-sec';d.open=true;"
    "var sm=document.createElement('summary');sm.textContent=sec[0];d.appendChild(sm);"
    "sec[1].forEach(function(c){var row=document.createElement('div');row.className='tp-row';"
    "var lab=document.createElement('label');var nm=document.createElement('span');nm.textContent=c.label;lab.appendChild(nm);var inp;"
    "if(c.t==='select'){row.appendChild(lab);inp=document.createElement('select');c.opts.forEach(function(o){var op=document.createElement('option');op.value=o[1];op.textContent=o[0];inp.appendChild(op);});"
    "var iv=(r.style.getPropertyValue('--'+c.k)||'').trim();inp.value=(iv&&c.opts.some(function(o){return o[1]===iv;}))?iv:c.def;setVar(c.k,inp.value,'');"
    "inp.addEventListener('change',function(){setVar(c.k,inp.value,'');dump();});"
    "CTRLS.push({k:c.k,get:function(){return inp.value;},reset:function(){inp.value=c.def;setVar(c.k,c.def,'');}});}"
    "else if(c.t==='color'){row.appendChild(lab);inp=document.createElement('input');inp.type='color';inp.value=toHex(r.style.getPropertyValue('--'+c.k)||cssVal(c.k))||c.def;setVar(c.k,inp.value,'');"
    "inp.addEventListener('input',function(){setVar(c.k,inp.value,'');dump();});"
    "CTRLS.push({k:c.k,get:function(){return inp.value;},reset:function(){inp.value=c.def;setVar(c.k,c.def,'');}});}"
    "else if(c.t==='colorhex'){row.appendChild(lab);var wrap=document.createElement('div');wrap.className='tp-colorhex';var sw=document.createElement('input');sw.type='color';var tx=document.createElement('input');tx.type='text';tx.spellcheck=false;"
    "var initv=(r.style.getPropertyValue('--'+c.k)||cssVal(c.k)||c.def).trim();var nh=normHex(initv)||c.def;tx.value=nh;sw.value=nh.slice(0,7);"
    "sw.addEventListener('input',function(){tx.value=sw.value;tx.classList.remove('bad');setVar(c.k,sw.value,'');dump();});"
    "tx.addEventListener('input',function(){var v=normHex(tx.value);if(v){tx.classList.remove('bad');sw.value=v.slice(0,7);setVar(c.k,v,'');dump();}else{tx.classList.add('bad');}});"
    "wrap.appendChild(sw);wrap.appendChild(tx);inp=wrap;"
    "CTRLS.push({k:c.k,get:function(){return tx.value;},sync:function(){if(r.style.getPropertyValue('--'+c.k))return;var sv=normHex(cssVal(c.k))||c.def;tx.value=sv;tx.classList.remove('bad');sw.value=sv.slice(0,7);},reset:function(){r.style.removeProperty('--'+c.k);var rv=normHex(cssVal(c.k))||c.def;tx.value=rv;tx.classList.remove('bad');sw.value=rv.slice(0,7);}});}"
    "else if(c.t==='toggle'){lab.className='tp-toggle';var ck=document.createElement('input');ck.type='checkbox';ck.checked=c.init?c.init():!!c.def;lab.insertBefore(ck,lab.firstChild);row.appendChild(lab);ck.addEventListener('change',function(){if(c.on)c.on(ck.checked);});if(c.on)c.on(ck.checked);inp=null;CTRLS.push({k:c.k,novar:true,get:function(){return ck.checked;},reset:function(){ck.checked=!!c.def;if(c.on)c.on(ck.checked);}});}"
    "else if(c.t==='file'){row.appendChild(lab);var fi=document.createElement('input');fi.type='file';fi.accept=c.accept||'image/*';fi.addEventListener('change',function(){var f=fi.files&&fi.files[0];if(!f)return;var rd=new FileReader();rd.onload=function(){if(c.on)c.on(rd.result);};rd.readAsDataURL(f);});row.appendChild(fi);if(c.onreset){var clr=document.createElement('button');clr.type='button';clr.className='tp-clear';clr.textContent='Use text name';clr.addEventListener('click',function(){fi.value='';c.onreset();});row.appendChild(clr);}inp=null;CTRLS.push({k:c.k,novar:true,get:function(){return '';},reset:function(){fi.value='';if(c.onreset)c.onreset();}});}"
    "else{var bb=document.createElement('b');lab.appendChild(bb);row.appendChild(lab);inp=document.createElement('input');inp.type='range';inp.min=c.min;inp.max=c.max;inp.step=c.step||1;"
    "var cv=parseFloat(cssVal(c.k));var v=isFinite(cv)?cv:c.def;inp.value=v;bb.textContent=v;setVar(c.k,v,c.unit||'');"
    "inp.addEventListener('input',function(){setVar(c.k,inp.value,c.unit||'');bb.textContent=inp.value;dump();});"
    "CTRLS.push({k:c.k,get:function(){return inp.value+(c.unit||'');},reset:function(){inp.value=c.def;bb.textContent=c.def;setVar(c.k,c.def,c.unit||'');}});}"
    "if(inp)row.appendChild(inp);d.appendChild(row);});host.appendChild(d);});dump();}"
    "function commit(el){el.removeAttribute('contenteditable');el.classList.remove('editing');if(!el.textContent.trim())el.innerHTML='';EDITS[el.getAttribute('data-edit-id')]=el.innerHTML;rtHide();sgTypeEcho();}"
    "var rtBar=document.getElementById('rtBar'),rtTarget=null;"
    "function rtPos(el){if(!rtBar||!el)return;rtBar.classList.add('show');var rc=el.getBoundingClientRect();var bw=rtBar.offsetWidth,bh=rtBar.offsetHeight;var top=rc.top-bh-8;if(top<6)top=rc.bottom+8;var left=rc.left+(rc.width-bw)/2;left=Math.max(6,Math.min(left,window.innerWidth-bw-6));rtBar.style.top=top+'px';rtBar.style.left=left+'px';}"
    "function rtShow(el){rtTarget=el;rtPos(el);}"
    "function rtHide(){if(rtBar)rtBar.classList.remove('show');rtTarget=null;}"
    "if(rtBar){rtBar.addEventListener('mousedown',function(e){var b=e.target.closest?e.target.closest('button[data-rt]'):null;if(!b)return;e.preventDefault();document.execCommand(b.getAttribute('data-rt'),false,null);if(rtTarget)EDITS[rtTarget.getAttribute('data-edit-id')]=rtTarget.innerHTML;});}"
    "window.addEventListener('scroll',function(){if(rtTarget)rtPos(rtTarget);},true);window.addEventListener('resize',function(){if(rtTarget)rtPos(rtTarget);});"
    "document.addEventListener('mousedown',function(e){if(!body.classList.contains('settings-on'))return;"
    "var el=e.target.closest?e.target.closest('[data-edit-id]'):null;if(!el)return;e.stopPropagation();e.preventDefault();"
    "el.setAttribute('contenteditable','true');el.classList.add('editing');"
    "var rng=document.createRange();rng.selectNodeContents(el);var sel=window.getSelection();sel.removeAllRanges();sel.addRange(rng);el.focus();rtShow(el);},true);"
    "document.addEventListener('blur',function(e){var el=e.target;if(el&&el.getAttribute&&el.getAttribute('contenteditable')==='true'&&el.hasAttribute('data-edit-id'))commit(el);},true);"
    "document.addEventListener('keydown',function(e){var el=e.target;if(el&&el.getAttribute&&el.getAttribute('contenteditable')==='true'){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();el.blur();}else if(e.key==='Escape'){el.blur();}e.stopPropagation();}},true);"
    "function buildHTML(){var clone=document.documentElement.cloneNode(true);var b=clone.querySelector('body');if(b)b.classList.remove('settings-on','presenting');"
    "clone.querySelectorAll('[contenteditable]').forEach(function(el){el.removeAttribute('contenteditable');el.classList.remove('editing');});"
    "var op=clone.querySelector('#tunePanel');if(op)op.classList.remove('open');"
    "clone.querySelectorAll('[data-hidden]').forEach(function(el){el.removeAttribute('data-hidden');});"
    "clone.querySelectorAll('.flow-node.is-primary').forEach(function(el){el.classList.remove('is-primary');});"
    "var od=clone.querySelector('#edits-data');if(od)od.parentNode.removeChild(od);"
    "var head=clone.querySelector('head');if(head&&Object.keys(EDITS).length){var sc=document.createElement('script');sc.id='edits-data';sc.textContent='window.__SAVED_EDITS='+JSON.stringify(EDITS)+';';head.insertBefore(sc,head.firstChild);}"
    "return '<!DOCTYPE html>'+clone.outerHTML;}"
    "function save(){var el=document.getElementById('saveName');var name=(el&&el.value)||'snowgram-diagram-edited.html';if(name.indexOf('.')<0)name+='.html';"
    "var blob=new Blob([buildHTML()],{type:'text/html'});var a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();"
    "setTimeout(function(){URL.revokeObjectURL(a.href);a.remove();},1500);}"
    "var CAPS=(window.__SG_CAPTIONS||{});var byId={},order=[],step=-1;"
    "function indexNodes(){byId={};document.querySelectorAll('.flow-node[data-node-id]').forEach(function(n){byId[n.getAttribute('data-node-id')]=n;});}"
    "function buildOrder(){indexNodes();var ns=[];for(var id in byId)ns.push(byId[id]);"
    "ns.sort(function(a,b){var ax=parseFloat(a.style.left)||0,ay=parseFloat(a.style.top)||0,bx=parseFloat(b.style.left)||0,by=parseFloat(b.style.top)||0;if(Math.abs(ax-bx)>40)return ax-bx;return ay-by;});"
    "order=ns.map(function(n){return n.getAttribute('data-node-id');});}"
    "function showUpTo(k){var shown={};order.forEach(function(id,i){var el=byId[id];if(!el)return;var hide=i>k;el.setAttribute('data-hidden',hide?'1':'0');if(!hide)shown[id]=1;});"
    "document.querySelectorAll('.connector-group').forEach(function(g){var s=g.getAttribute('data-source-id'),t=g.getAttribute('data-target-id');g.setAttribute('data-hidden',(shown[s]&&shown[t])?'0':'1');});"
    "if(k<0){var cb0=document.getElementById('capBar');if(cb0){cb0.querySelector('.cap-step').textContent='Cover';cb0.querySelector('.cap-title').textContent='';cb0.querySelector('.cap-text').textContent='';}document.querySelectorAll('.flow-node').forEach(function(n){n.classList.remove('is-primary');});return;}"
    "var id=order[k],el=byId[id];var tn=el?el.querySelector('.fn-title'):null,sn=el?el.querySelector('.fn-sub'):null;"
    "var title=tn?tn.textContent:id;var sub=(sn&&!sn.classList.contains('sg-echo'))?sn.textContent:'';var cap=CAPS[id]||(sub?(title+' \\u2014 '+sub):title);"
    "var cb=document.getElementById('capBar');if(cb){cb.querySelector('.cap-step').textContent=(k+1)+' / '+order.length;cb.querySelector('.cap-title').textContent=title;cb.querySelector('.cap-text').textContent=cap;}"
    "document.querySelectorAll('.flow-node').forEach(function(n){n.classList.toggle('is-primary',n===el);});}"
    "function startPresent(){setSettings(false);buildOrder();if(!order.length&&!coverWanted)return;body.classList.add('presenting');if(coverWanted){gotoCover();step=-1;showUpTo(-1);}else{gotoArch();step=0;showUpTo(0);}}"
    "function exitPresent(){if(!body.classList.contains('presenting'))return;body.classList.remove('presenting');body.classList.remove('chrome-reveal');"
    "document.querySelectorAll('[data-hidden]').forEach(function(el){el.removeAttribute('data-hidden');});"
    "document.querySelectorAll('.flow-node.is-primary').forEach(function(n){n.classList.remove('is-primary');});step=-1;if(coverWanted)gotoCover();else gotoArch();}"
    "function nav(d){if(!body.classList.contains('presenting'))return;if(onCover){if(d>0){gotoArch();step=0;showUpTo(0);}return;}if(d<0&&step<=0){if(coverWanted){gotoCover();step=-1;showUpTo(-1);}return;}if(d>0&&step>=order.length-1)return;step+=d;showUpTo(step);}"
    "function wireHover(){var root=document.querySelector('.diagram-root');if(!root)return;"
    "var fns=[].slice.call(document.querySelectorAll('.flow-node[data-node-id]'));"
    "var grps=[].slice.call(document.querySelectorAll('.connector-group'));"
    "var nbr={},nedges={};grps.forEach(function(g){var s=g.getAttribute('data-source-id'),t=g.getAttribute('data-target-id');(nbr[s]=nbr[s]||{})[t]=1;(nbr[t]=nbr[t]||{})[s]=1;(nedges[s]=nedges[s]||[]).push(g);(nedges[t]=nedges[t]||[]).push(g);});"
    "fns.forEach(function(n){n.addEventListener('mouseenter',function(){if(body.classList.contains('presenting')||body.classList.contains('settings-on'))return;"
    "var id=n.getAttribute('data-node-id');root.classList.add('hovering');"
    "fns.forEach(function(m){var mid=m.getAttribute('data-node-id');m.classList.toggle('hl',mid===id||!!(nbr[id]&&nbr[id][mid]));m.classList.remove('hl-src');});"
    "n.classList.add('hl-src');grps.forEach(function(g){g.classList.remove('hl-edge');});(nedges[id]||[]).forEach(function(g){g.classList.add('hl-edge');});});"
    "n.addEventListener('mouseleave',function(){root.classList.remove('hovering');fns.forEach(function(m){m.classList.remove('hl','hl-src');});grps.forEach(function(g){g.classList.remove('hl-edge');});});});}"
    "function wire(){buildTuner();applyEdits(document);sgTypeEcho();wireHover();var p=document.getElementById('tunePanel');"
    "var tab=document.getElementById('tuneTab');if(tab)tab.addEventListener('click',function(){if(p)p.classList.add('open');});"
    "var cl=document.getElementById('tuneClose');if(cl)cl.addEventListener('click',function(){if(p)p.classList.remove('open');});"
    "var sv=document.getElementById('tuneSave');if(sv)sv.addEventListener('click',save);"
    "var rs=document.getElementById('tuneReset');if(rs)rs.addEventListener('click',function(){TKEYS.forEach(function(k){r.style.removeProperty('--'+k);});buildTuner();});"
    "var cp=document.getElementById('tuneCopy');if(cp)cp.addEventListener('click',function(){var t=document.getElementById('tuneDump');if(!t)return;t.select();try{document.execCommand('copy');}catch(e){}var o=cp.textContent;cp.textContent='Copied';setTimeout(function(){cp.textContent=o;},1200);});"
    "var pb=document.getElementById('presentBtn');if(pb)pb.addEventListener('click',function(){if(body.classList.contains('presenting'))exitPresent();else startPresent();});"
    "document.querySelectorAll('#capBar [data-cap]').forEach(function(b){b.addEventListener('click',function(ev){ev.stopPropagation();var a=b.getAttribute('data-cap');if(a==='next')nav(1);else if(a==='prev')nav(-1);else exitPresent();});});"
    "var cv=document.querySelector('.canvas');if(cv)cv.addEventListener('click',function(){if(body.classList.contains('presenting'))nav(1);});"
    "var cn=document.getElementById('coverNav');if(cn)cn.addEventListener('click',function(){onCover?gotoArch():gotoCover();});"
    "var pc=document.getElementById('pkCover');if(pc)pc.addEventListener('click',function(){if(body.classList.contains('presenting')){nav(1);}else if(!body.classList.contains('settings-on')&&onCover){gotoArch();}});"
    "document.addEventListener('keydown',function(e){if(body.classList.contains('presenting')||body.classList.contains('settings-on'))return;if(!coverWanted||!onCover)return;if(e.key==='ArrowRight'||e.key===' '||e.key==='Enter'){e.preventDefault();gotoArch();}});"
    "var rp=document.getElementById('ribbonPresent');if(rp)rp.addEventListener('click',function(){startPresent();});"
    "syncCoverChrome();"
    "document.addEventListener('keydown',function(e){if(body.classList.contains('presenting')){if(e.key==='ArrowRight'||e.key===' '){e.preventDefault();nav(1);}else if(e.key==='ArrowLeft'||e.key==='Backspace'){e.preventDefault();nav(-1);}else if(e.key==='Escape'){exitPresent();}}});"
    "if(window.MutationObserver){new MutationObserver(function(){CTRLS.forEach(function(c){if(c.sync)c.sync();});dump();}).observe(r,{attributes:true,attributeFilter:['data-theme']});}}"
    "if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',wire);else wire();})();"
)


def _html(layout, icons, edge_labels, title, doc, edge_bidir=None, edge_styles=None):
    t = _xesc(title or 'SnowGram Diagram')
    W = int(round(layout.get('width') or 800))
    H = int(round(layout.get('height') or 400))
    nodes = layout.get('nodes', [])
    zones = layout.get('zones', [])
    edges = layout.get('edges', [])
    pad = 46
    W2, H2 = W + 2 * pad, H + 2 * pad

    # normalized (label -> id) index so summary bullets can fuzzy-match their tile
    node_idx = [(_norm(n.get('label') or n['id']), n['id']) for n in nodes]

    # connectors svg is padded via a negative-origin viewBox; cards are offset by +pad to match
    s = ['<svg data-connectors-svg class="connectors" width="' + str(W2) + '" height="' + str(H2) +
         '" viewBox="' + str(-pad) + ' ' + str(-pad) + ' ' + str(W2) + ' ' + str(H2) + '" xmlns="http://www.w3.org/2000/svg">']
    s.append('<defs>'
             '<marker id="ah" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto" markerUnits="userSpaceOnUse"><path class="conn-arrow" d="M0,0 L7,3 L0,6 Z"/></marker>'
             '<marker id="ah-gov" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto" markerUnits="userSpaceOnUse"><path class="conn-arrow-gov" d="M0,0 L7,3 L0,6 Z"/></marker>'
             '<marker id="ah-leg" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto" markerUnits="userSpaceOnUse"><path class="conn-arrow-leg" d="M0,0 L7,3 L0,6 Z"/></marker>'
             '<marker id="ah-plink" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto" markerUnits="userSpaceOnUse"><path class="conn-arrow-plink" d="M0,0 L7,3 L0,6 Z"/></marker>'
             '<marker id="ah-dshare" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto" markerUnits="userSpaceOnUse"><path class="conn-arrow-dshare" d="M0,0 L7,3 L0,6 Z"/></marker>'
             '<marker id="ah-start" markerWidth="9" markerHeight="9" refX="2" refY="3" orient="auto" markerUnits="userSpaceOnUse"><path class="conn-arrow" d="M7,0 L0,3 L7,6 Z"/></marker>'
             '<marker id="ah-gov-start" markerWidth="9" markerHeight="9" refX="2" refY="3" orient="auto" markerUnits="userSpaceOnUse"><path class="conn-arrow-gov" d="M7,0 L0,3 L7,6 Z"/></marker>'
             '<marker id="ah-leg-start" markerWidth="9" markerHeight="9" refX="2" refY="3" orient="auto" markerUnits="userSpaceOnUse"><path class="conn-arrow-leg" d="M7,0 L0,3 L7,6 Z"/></marker>'
             '<marker id="ah-plink-start" markerWidth="9" markerHeight="9" refX="2" refY="3" orient="auto" markerUnits="userSpaceOnUse"><path class="conn-arrow-plink" d="M7,0 L0,3 L7,6 Z"/></marker>'
             '<marker id="ah-dshare-start" markerWidth="9" markerHeight="9" refX="2" refY="3" orient="auto" markerUnits="userSpaceOnUse"><path class="conn-arrow-dshare" d="M7,0 L0,3 L7,6 Z"/></marker>'
             '</defs>')
    b = layout.get('platformBoundary')
    if b:
        b_label = str(b.get('label') or 'Snowflake Data Cloud').upper()
        b_sub = str(b.get('subtitle') or '')
        s.append('<rect class="b-rect" x="' + str(round(b['x'], 1)) + '" y="' + str(round(b['y'], 1)) + '" width="' +
                 str(round(b['w'], 1)) + '" height="' + str(round(b['h'], 1)) + '" rx="14" fill="none" '
                 'stroke-width="2" stroke-dasharray="8 5"/>')
        s.append('<text class="b-label" x="' + str(round(b['x'] + 12, 1)) + '" y="' + str(round(b['y'] + 20, 1)) +
                 '">' + _xesc(b_label) + '</text>')
        if b_sub:
            s.append('<text class="b-sub" x="' + str(round(b['x'] + 12, 1)) + '" y="' + str(round(b['y'] + 33, 1)) +
                     '">' + _xesc(b_sub) + '</text>')
    for c in _containers_sorted(layout):
        cc = c.get('color') or None
        c_stroke = (' stroke="' + cc + '"') if cc else ''
        c_color = (' fill="' + cc + '"') if cc else ''
        s.append('<rect class="container-rect" x="' + str(round(c['x'], 1)) + '" y="' + str(round(c['y'], 1)) + '" width="' +
                 str(round(c['w'], 1)) + '" height="' + str(round(c['h'], 1)) + '" rx="12" fill="none"' + c_stroke + '/>'  )
        s.append('<text class="container-label" x="' + str(round(c['x'] + 12, 1)) + '" y="' + str(round(c['y'] + 18, 1)) +
                 '"' + c_color + '>' + _xesc(str(c.get('label') or c['id']).upper()) + '</text>')
        sub = str(c.get('subtitle') or '')
        if sub:
            s.append('<text class="container-subtitle" x="' + str(round(c['x'] + 12, 1)) + '" y="' + str(round(c['y'] + 31, 1)) + '"' + c_color + ' opacity="0.7">' + _xesc(sub) + '</text>')
    for z in zones:
        _f, stroke = _pal(z.get('category'))
        s.append('<rect x="' + str(round(z['x'], 1)) + '" y="' + str(round(z['y'], 1)) + '" width="' +
                 str(round(z['w'], 1)) + '" height="' + str(round(z['h'], 1)) + '" rx="12" fill="' + stroke +
                 '" fill-opacity="0.08" stroke="' + stroke + '" stroke-opacity="0.55" stroke-width="1.25"/>')
        s.append('<text class="z-label" x="' + str(round(z['x'] + 12, 1)) + '" y="' + str(round(z['y'] + 21, 1)) +
                 '">' + _xesc(str(z['name']).upper()) + '</text>')
    _nm = _node_meta(layout)
    _ebidir = edge_bidir or {}
    _estyles = edge_styles or {}
    _cat_marker = {'dataflow': 'ah', 'governance': 'ah-gov', 'legacy': 'ah-leg',
                   'private_link': 'ah-plink', 'data_share': 'ah-dshare'}
    _cat_start  = {'dataflow': 'ah-start', 'governance': 'ah-gov-start', 'legacy': 'ah-leg-start',
                   'private_link': 'ah-plink-start', 'data_share': 'ah-dshare-start'}
    _cats_used = set()
    for e in edges:
        pts = e.get('points') or []
        if not pts:
            continue
        d = 'M' + str(round(pts[0][0], 1)) + ',' + str(round(pts[0][1], 1))
        for q in pts[1:]:
            d += ' L' + str(round(q[0], 1)) + ',' + str(round(q[1], 1))
        lbl = edge_labels.get(str(e.get('from')) + '|' + str(e.get('to')))
        _explicit = _estyles.get(str(e.get('from')) + '|' + str(e.get('to')))
        cat = _explicit if _explicit in _cat_marker else _edge_cat(e, lbl, _nm)
        _cats_used.add(cat)
        is_bidir = bool(_ebidir.get(str(e.get('from')) + '|' + str(e.get('to'))))
        mstart = (' marker-start="url(#' + _cat_start[cat] + ')"') if is_bidir else ''
        s.append('<g class="connector-group cat-' + cat + '" data-source-id="' + _xesc(e.get('from')) + '" data-target-id="' +
                 _xesc(e.get('to')) + '"><path class="connector-hit" d="' + d + '"/>'
                 '<path class="connector-path" d="' + d + '"' + mstart + ' marker-end="url(#' + _cat_marker[cat] + ')"/></g>')
    s.append('</svg>')

    # wide (icon-left) node when the HTML layout carries componentType (merged by GENERATE)
    wide = any(('componentType' in n) for n in nodes)
    cards = []
    for n in nodes:
        w, h = round(float(n['w']), 1), round(float(n['h']), 1)
        lx, ty = round(float(n['x']) + pad, 1), round(float(n['y']) + pad, 1)
        uri = icons.get(n['id'])
        label = n.get('label') or n['id']
        tid = 'node:' + str(n['id']) + ':title'
        if n.get('style') == 'gateway':
            # Small icon-only chip + caption, no card chrome -- network
            # plumbing (Azure Private Link / AWS PrivateLink), not a full
            # service card.
            ico = (('<img src="' + uri + '" alt=""/>') if uri else '')
            inner = ('<span class="gw-chip">' + ico + '</span>'
                     '<span class="gw-caption" data-edit-id="' + _xesc(tid) + '">' + _xesc(label) + '</span>')
            cards.append('<div class="flow-node gateway-node" data-node-id="' + _xesc(n['id']) + '" style="left:' + str(lx) +
                         'px;top:' + str(ty) + 'px;width:' + str(w) + 'px;height:' + str(h) + 'px">' + inner + '</div>')
            continue
        if n.get('style') == 'chip':
            # Inline pill for one stage of a medallion pipeline (Bronze ->
            # Silver -> Gold) -- centered at a fixed pill height regardless
            # of the box's own h (a taller sibling elsewhere may stretch it).
            inner = '<span class="chip-label" data-edit-id="' + _xesc(tid) + '">' + _xesc(label) + '</span>'
            cards.append('<div class="flow-node chip-node" data-node-id="' + _xesc(n['id']) + '" style="left:' + str(lx) +
                         'px;top:' + str(ty) + 'px;width:' + str(w) + 'px;height:' + str(h) + 'px">' + inner + '</div>')
            continue
        if wide:
            ico = '<span class="fn-ico">' + (('<img src="' + uri + '" alt=""/>') if uri else '') + '</span>'
            _ct = n.get('componentType') or ''
            # Always EMIT the type line so it stays editable in Customize; whether
            # it SHOWS is decided live in the browser (sgTypeEcho hides it when it
            # merely echoes the title, and re-evaluates on every edit so a rename
            # self-heals). Pre-flag the redundant ones server-side too (sg-echo),
            # so the default view has no first-paint flash before the JS runs.
            sub = _xesc(_ct)
            sub_echo = _type_echoes(_ct, label)
            det = _xesc(n.get('detail') or '')
            txt = '<span class="fn-text"><span class="fn-title" data-edit-id="' + _xesc(tid) + '">' + _xesc(label) + '</span>'
            if sub:
                txt += '<span class="fn-sub' + (' sg-echo' if sub_echo else '') + '" data-edit-id="node:' + _xesc(str(n['id'])) + ':sub">' + sub + '</span>'
            if det:
                txt += '<span class="fn-detail" data-edit-id="node:' + _xesc(str(n['id'])) + ':detail">' + det + '</span>'
            txt += '</span>'
            inner = ico + txt
        else:
            inner = (('<img src="' + uri + '" alt=""/>') if uri else '') + '<span class="fn-title" data-edit-id="' + _xesc(tid) + '">' + _xesc(label) + '</span>'
        cards.append('<div class="flow-node" data-node-id="' + _xesc(n['id']) + '" style="left:' + str(lx) +
                     'px;top:' + str(ty) + 'px;width:' + str(w) + 'px;height:' + str(h) + 'px">' + inner + '</div>')

    rootcls = 'diagram-root nodes-wide' if wide else 'diagram-root'
    diagram = ('<div class="' + rootcls + '" data-diagram-root style="position:relative;width:' + str(W2) +
               'px;height:' + str(H2) + 'px">' + ''.join(s) + ''.join(cards) + '</div>')

    seen_cat, legend_items = set(), []
    for z in zones:
        cat = z.get('category') or 'default'
        if cat in seen_cat:
            continue
        seen_cat.add(cat)
        col = _pal(cat)[1]
        legend_items.append('<span class="item"><span class="sw" style="background:' + col +
                            '"></span>' + _xesc(_CAT_LABEL.get(cat, cat.title())) + '</span>')
    # Edge-style key: mirrors the static-SVG legend so the interactive HTML
    # also explains the connector colors (data flow / governance / legacy /
    # private connectivity / secure data sharing). Uses the SAME CSS-var
    # colors + dash patterns the connectors themselves render with, and only
    # shows styles actually present in this diagram (collected in _cats_used).
    _edge_legend = [
        ('dataflow', 'Data flow', 'var(--connector-color)', ''),
        ('governance', 'Governance / policy', 'var(--container-color)', '1.5 3'),
        ('legacy', 'Legacy / transitional', 'var(--legacy-color)', '7 4'),
        ('private_link', 'Private connectivity', 'var(--private-link-color)', ''),
        ('data_share', 'Secure data sharing', 'var(--data-share-color)', ''),
    ]
    for _cat, _lab, _col, _dash in _edge_legend:
        if _cat not in _cats_used:
            continue
        _da = (' stroke-dasharray="' + _dash + '"') if _dash else ''
        _sw = ('<svg class="sw-line" width="22" height="8" viewBox="0 0 22 8" aria-hidden="true">'
               '<line x1="0" y1="4" x2="22" y2="4" stroke="' + _col + '" stroke-width="2"' + _da + '/></svg>')
        legend_items.append('<span class="item">' + _sw + _xesc(_lab) + '</span>')
    legend = ('<div class="legend">' + ''.join(legend_items) + '</div>') if legend_items else ''

    # summary-bullet hover -> replay the node's own hover behavior (reuses interactivity wiring)
    ref_js = ('<script>(function(){function f(){var m={};'
              "document.querySelectorAll('.flow-node[data-node-id]').forEach(function(n){m[n.getAttribute('data-node-id')]=n;});"
              "document.querySelectorAll('[data-node-ref]').forEach(function(el){var n=m[el.getAttribute('data-node-ref')];if(!n)return;"
              "el.addEventListener('mouseenter',function(){n.dispatchEvent(new Event('mouseenter'));});"
              "el.addEventListener('mouseleave',function(){n.dispatchEvent(new Event('mouseleave'));});});}"
              "if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',f);else f();})();</script>")

    # per-node captions for present mode: map doc component roles onto node ids
    caps = {}
    for c in ((doc or {}).get('components') or []):
        ref = _match_node(c.get('component') or '', node_idx)
        if ref and c.get('role'):
            caps[ref] = c.get('role')
    caps_js = '<script>window.__SG_CAPTIONS=' + json.dumps(caps) + '</script>'

    return ('<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/>'
            '<meta name="viewport" content="width=device-width,initial-scale=1"/>'
            '<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&family=Inter:wght@400;500;600;700;800;900&family=Lora:wght@400;500;600;700&family=Manrope:wght@400;500;600;700;800&family=Sora:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet"/>'
            '<title>' + t + '</title><style>' + _INTERACT_CSS + ' ' + _THEME_CSS + ' ' + _PANEL_CSS + '</style>' + _THEME_INIT + '</head><body>'
            '<header class="app-header"><div class="brand">'
            + (('<span id="brandLogo" class="brand-logo-wrap" title="Customize and edit: click the logo"><img class="brand-logo" src="' + _LOGO_WHITE_URI + '" alt="Snowflake"/><span class="brand-gear" aria-hidden="true">&#9881;</span></span>') if _LOGO_WHITE_URI else '')
            + '<h1 class="title" data-edit-id="hdr:title">' + t + '</h1></div>'
            '<div class="app-actions">'
            '<button id="customizeBtn" class="present-btn" type="button">Customize</button>'
            '<button id="presentBtn" class="present-btn" type="button">Present</button>'
            '<button id="themeToggle" class="theme-toggle" type="button" aria-label="Toggle theme">&#9728;</button></div></header>'
            + legend +
            '<div class="canvas">' + diagram + _doc_html_panel(doc, node_idx) + '</div>'
            + _PANEL_MARKUP +
            '<div id="pkCover" aria-hidden="true"><div class="pk-cover-inner">' +
            (('<img class="pk-cover-mark" src="' + _LOGO_WHITE_URI + '" alt="Snowflake"/>') if _LOGO_WHITE_URI else '') +
            '<div class="pk-cover-rule"></div><div class="pk-cover-presented">Presented to</div>' +
            '<div class="pk-cover-customer"><img id="pkCoverLogo" alt="" hidden/>' +
            '<div class="pk-cover-name" data-edit-id="cover:customer">Customer Name</div></div>' +
            '<div class="pk-cover-meta"><div class="pk-cover-presenter" data-edit-id="cover:presenter" data-ph="Presenter name"></div>' +
            '<div class="pk-cover-date" data-edit-id="cover:date" data-ph="Date"></div></div></div></div>' +
            '<button id="coverNav" type="button" aria-label="Toggle cover / architecture"></button>' +
            '<script>' + _INTERACT_JS + '</script>'
            '<script>(window.SnowGramInteractivity||{}).autoAttachOnReady&&window.SnowGramInteractivity.autoAttachOnReady();</script>'
            + ref_js + caps_js +
            '<script>' + _PANEL_JS + '</script>'
            '</body></html>')


def render(layout, enrich, title, html_layout=None):
    icons = (enrich or {}).get('icons', {}) or {}
    edge_labels = (enrich or {}).get('edgeLabels', {}) or {}
    edge_bidir = (enrich or {}).get('edgeBidirectional', {}) or {}
    edge_styles = (enrich or {}).get('edgeStyles', {}) or {}
    doc = _doc_norm((enrich or {}).get('doc'))
    svg = _svg(html_layout or layout, icons, edge_labels, title, doc, edge_bidir, edge_styles)
    drawio = _drawio(layout, icons, edge_labels, title, doc)
    mmd = _mermaid(layout, icons, edge_labels, title, doc)
    html = _html(html_layout or layout, icons, edge_labels, title, doc, edge_bidir, edge_styles)
    return {'mmd': mmd, 'drawio': drawio, 'svg': svg, 'html': html}


def run(layout_json, enrich_json, title, html_layout_json=None):
    layout = json.loads(layout_json) if isinstance(layout_json, str) else (layout_json or {})
    enrich = (json.loads(enrich_json) if (enrich_json and isinstance(enrich_json, str)) else (enrich_json or {})) or {}
    html_layout = None
    if html_layout_json:
        try:
            html_layout = json.loads(html_layout_json) if isinstance(html_layout_json, str) else html_layout_json
        except Exception:
            html_layout = None
    return render(layout, enrich, title, html_layout)

$$;
