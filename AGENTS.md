<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Offer in the shared dashboard navigation only the CRM entry points the tenant's preset keeps: `hiddenRoutesForPreset` (presets.ts) is the single switch for `hiddenCoreKeys` and the leads opt-in, so menu, links, dashboard tiles and page guards can never disagree. Still deduplicate configured module links and let navigation scroll independently so all sections stay reachable on short screens.
- Use TanStack Router's exported error props for route error components so their signatures follow the installed router contract.
- The leads section stays off unless a preset opts in by listing `leads` in its `extraCoreKeys` — only the o‘quv markazi preset does, so every other preset's leads page still redirects to the dashboard. Opting in also un-hides the "Bugun nima qilish kerak?" inquiry tile, which must keep counting only `new`/`needs_attention` rows and must skip the query entirely when the section is hidden. The lead board stays wired to the existing leads query and authenticated updateLead operation (sharing status grouping with its tests) so lead records created from Telegram conversations remain correct and authorised.
