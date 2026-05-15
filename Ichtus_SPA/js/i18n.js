/* ============================================
   INTERNATIONALIZATION (i18n) SYSTEM
   Supports Dutch (nl) and English (en)
   ============================================ */

const i18n = {
    lang: 'nl', // Default language
    translations: {},

    // Translation keys - organized by module/context
    strings: {
        nl: {
            // ==================== GLOBAL ====================
            app_title: 'Ichtus Workspace',
            save: 'Opslaan',
            cancel: 'Annuleren',
            delete: 'Verwijderen',
            close: 'Sluiten',
            confirm: 'Bevestigen',
            edit: 'Bewerken',
            remove: 'Verwijderen',
            add: 'Toevoegen',
            name: 'Naam',
            new: 'Nieuw',
            copy: 'Kopiëren',
            export: 'Exporteren',
            import: 'Importeren',
            ok: 'OK',
            loading: 'Laden...',
            overview: 'Overzicht',
            back: 'Terug',
            search: 'Zoeken',
            filter: 'Filter',
            all: 'Alle',
            none: 'Geen',
            settings: 'Instellingen',
            toast_saved: 'Instelling opgeslagen!',
            toast_copied: 'Gekopieerd naar klembord!',
            reset: 'Reset',
            archive: 'Archiveer',
            'on': 'Aan',
            off: 'Uit',

            // ==================== ROUTER / SIDEBAR ====================
            nav_dashboard: 'Dashboard',
            nav_agenda: 'Agenda',
            nav_checklist: 'Checklists',
            nav_patchbay: 'Patchbay',
            nav_analytics: 'Analytics',
            nav_setlist: 'Setlist',
            nav_ndi: 'NDI',
            nav_settings: 'Instellingen',

            // ==================== CHECKLIST MODULE ====================
            // Role selector
            role_selector_title: 'Selecteer Station',
            role_admin: 'Coördinator',
            role_beamer: 'Beamer Team',
            role_worship: 'Worship Team',
            role_switch: 'Wissel Rol',

            // Overview
            checklist_title: 'Checklists',
            cl_back: 'Terug naar overzicht',
            cl_no_checklists: 'Geen checklists gevonden',
            cl_new_checklist: 'Nieuwe checklist',
            cl_manage: 'Beheer',
            cl_tags: 'Tags',
            cl_filter_label: 'Filter:',
            cl_clear_filter: 'wissen',
            cl_item_name: 'Taak naam',
            cl_edit_item: 'Item Bewerken',
            cl_team_placeholder: 'Bijv. Beamer',
            cl_empty_items: 'Nog geen items in deze checklist',
            cl_add_item: 'Item toevoegen',
            cl_completed: 'voltooid',

            // Item cards
            cl_item_mark_open: 'Markeer open',
            cl_item_mark_done: 'Markeer voltooid',

            // Modals
            cl_new_item_title: 'Nieuw Item',
            cl_item_name_placeholder: 'Bijv. Projector aan',
            cl_deadline_time: 'Deadline tijd',
            cl_team: 'Team',
            cl_add: 'Toevoegen',
            cl_create_checklist: 'Nieuwe Checklist',
            cl_checklist_name: 'Checklist naam',
            cl_checklist_duedate: 'Deadline datum',
            cl_checklist_duetime: 'Start tijd',
            cl_checklist_repeat: 'Herhalen',
            cl_repeat_none: 'Geen',
            cl_repeat_daily: 'Dagelijks',
            cl_repeat_weekly: 'Wekelijks',
            cl_repeat_biweekly: 'Tweewekelijks',
            cl_repeat_monthly: 'Maandelijks',
            cl_repeat_yearly: 'Jaarlijks',
            cl_edit_checklist: 'Bewerk Checklist',
            cl_edit_items: 'Items',
            cl_edit_new_item_placeholder: 'Nieuw item naam...',
            cl_edit_item_delete_confirm: 'Item verwijderen?',
            cl_edit_no_tags: 'Nog geen tags',
            cl_edit_no_checklists: 'Geen checklists',
            cl_edit_items_count: 'items',

            // Confirmations
            cl_confirm_delete_checklist: 'Weet je zeker dat je deze checklist wilt verwijderen?',
            cl_confirm_delete_item: 'Weet je zeker dat je dit item wilt verwijderen?',
            cl_confirm_delete_tag: 'Weet je zeker dat je deze tag wilt verwijderen?',
            cl_confirm_archive: 'Huidige dienst archiveren en resetten?',
            cl_checklist_not_found: 'Checklist niet gevonden',

            // Legacy task management
            cl_legacy_no_tasks: 'Geen taken gevonden voor de geselecteerde rol',
            cl_legacy_delete_task: 'Taak definitief verwijderen?',

            // Presets
            cl_preset_new_name: 'Naam voor de nieuwe dienst lijst:',
            cl_preset_dup_suffix: '(Kopie)',
            cl_preset_rename_prompt: 'Nieuwe naam voor',
            cl_preset_cannot_delete: 'Je kunt de laatste lijst niet verwijderen.',
            cl_preset_confirm_delete: 'Weet je zeker dat je de lijst',
            cl_preset_wilt_verwijderen: 'wilt verwijderen?',

            // Tags
            cl_tag_manager: 'Tag Beheer',
            cl_tag_name: 'Tag naam',
            cl_tag_icon: 'Icoon',
            cl_tag_color: 'Kleur',
            cl_tag_add: 'Tag Toevoegen',

            // ==================== AGENDA MODULE ====================
            agenda_visible: 'Zichtbaar (Klik op titel om te hernoemen):',
            agenda_fetching: 'Bezig met ophalen...',
            agenda_template_restored: 'Template hersteld uit geheugen.',
            agenda_image_too_large: 'Afbeelding te groot voor LocalStorage!',
            agenda_this_week: 'Deze Week',
            agenda_week: 'Week',
            agenda_items_visible: 'items zichtbaar.',
            agenda_no_items: 'Geen items geselecteerd.',
            agenda_events_found: 'events gevonden...',
            agenda_ical_error: 'ICAL library probleem: ',
            agenda_network_error: 'Netwerk fout — CORS proxy onbereikbaar. Probeer te herladen.',
            agenda_server_error: 'Server fout: ',
            agenda_error: 'Fout: ',


            // ==================== SETLIST MODULE ====================
            setlist_waiting: 'Wachten op setlist van WorshipTools...',
            setlist_extract_help: 'Open WorshipTools, ga naar Planning, en klik op "Extract Setlist" in de Chrome extensie.',
            setlist_received: 'Setlist ontvangen van WorshipTools',
            setlist_received_at: 'Ontvangen:',
            setlist_service_date: 'Dienst datum:',
            setlist_no_date: 'Geen datum ontvangen (playlist wordt "Web Sync")',
            setlist_testing: 'Testen...',
            setlist_connected: 'Verbonden ✓',
            setlist_test_connection: '🔍 Test Verbinding',
            setlist_new_template: 'Nieuwe Template',
            setlist_confirm_delete: 'Weet je zeker dat je',
            setlist_wilt_verwijderen: 'wilt verwijderen?',
            setlist_confirm_reset: 'Terugzetten naar standaard instellingen? Alle wijzigingen gaan verloren.',
            setlist_cannot_delete_last: 'Je kunt de laatste template niet verwijderen.',
            setlist_cleared: 'Setlist gewist.',
            setlist_syncing: 'Sync bezig...',


            setlist_empty_preview: 'Open WorshipTools, ga naar Planning, en klik op "Extract Setlist" in de Chrome extensie.',
            setlist_header_name: 'Header/Item Name',
            setlist_target_uuid: 'Target UUID',
            setlist_destination: 'Destination',

            // ==================== SETTINGS MODULE ====================
            settings_title: 'Instellingen',
            settings_subtitle: 'Bekijk en beheer uw app configuratie',
            settings_language: 'Taal',
            settings_language_desc: 'Selecteer de weergavetaal van de applicatie',
            settings_dutch: 'Nederlands',
            settings_english: 'English',
            settings_firebase: 'Firebase Configuration',
            settings_not_configured: 'Firebase is not configured.',
            settings_configure: 'Configure Firebase',
            settings_edit: 'Bewerk Firebase Config',
            settings_reset: 'Reset Firebase Config',
            settings_network: 'Netwerk & Sync',
            settings_offline: 'Offline Modus',
            settings_offline_desc: 'Sta toe dat de app werkt zonder internet verbinding',
            settings_debug: 'Toon Debug Panel',
            settings_debug_desc: 'Toon Firebase status en sync logs',
            settings_ndi: 'NDI Video',
            settings_ndi_auto: 'Auto-Discovery',
            settings_ndi_auto_desc: 'Automatisch zoeken naar NDI bronnen',
            settings_ndi_quality: 'Preview Kwaliteit',
            settings_ndi_quality_desc: 'Beeldkwaliteit voor NDI preview (performance impact)',
            settings_ndi_low: 'Laag',
            settings_ndi_medium: 'Middel',
            settings_ndi_high: 'Hoog',
            settings_display: 'Weergave',
            settings_clock: 'Tijd Formaat',
            settings_clock_desc: 'Hoe tijden worden weergegeven',
            settings_clock_12h: '12-uur (2:30 PM)',
            settings_clock_24h: '24-uur (14:30)',
            settings_date: 'Datum Formaat',
            settings_date_desc: 'Hoe datums worden weergegeven',
            settings_date_dmy: 'DD-MM-YYYY (25-12-2024)',
            settings_date_mdy: 'MM-DD-YYYY (12-25-2024)',
            settings_data: 'Data Beheer',
            settings_clear_cache: 'Firebase Cache Legen',
            settings_clear_cache_desc: 'Verwijder lokaal gecachte Firebase data',
            settings_clear_all: 'Alle Lokale Data Wissen',
            settings_clear_all_desc: 'Reset alle instellingen en lokale data',
            settings_clear_cache_btn: 'Cache Legen',
            settings_clear_all_btn: 'Alles Wissen',
            settings_app_info: 'App Info',
            settings_version: 'App Versie',
            settings_firebase_status: 'Firebase Status',
            settings_configured: 'Geconfigureerd',
            settings_not_configured_status: 'Niet geconfigureerd',
            settings_config_source: 'Firebase Config Bron',
            settings_offline_status: 'Offline Modus',
            settings_active: 'Actief',
            settings_inactive: 'Uit',
            settings_confirm_reset_firebase: 'Weet u zeker dat u de Firebase configuratie wilt resetten? U moet daarna opnieuw inloggen.',
            settings_confirm_clear_cache: 'Wilt u de Firebase cache wissen? Dit verwijdert lokaal gecachte data maar behoudt uw instellingen.',
            settings_confirm_clear_all: 'WAARSCHUWING: Dit wist ALLE lokale data inclusief instellingen, agenda, en checklists. Dit kan niet ongedaan worden! Wilt u doorgaan?',
            settings_confirm_clear_all2: 'Weet u het zeker? Typ ok in de volgende prompt.',
            settings_edit_title: 'Firebase Config Bewerken',
            settings_save_firebase: 'Opslaan',
            settings_cancel: 'Annuleren',
            settings_invalid_api: 'Ongeldig API Key formaat (moet beginnen met AIza)',
            settings_required_fields: 'API Key, Project ID en App ID zijn verplicht.',
            settings_saved_firebase: 'Firebase configuratie opgeslagen!',
            settings_cleared_cache: 'Firebase cache gewist!',
            settings_cleared_all: 'Alle data gewist!',
            settings_reset_firebase: 'Firebase configuratie gereset',
            settings_config_source_browser: 'Browser (localStorage)',
            settings_config_source_server: 'Server Injected',
            settings_config_source_global: 'Global Variable',
            settings_config_source_none: 'Niet geconfigureerd',

            // ==================== FULLSCREEN ====================
            fullscreen_enter: 'Volledig scherm',
            fullscreen_exit: 'Volledig scherm afsluiten',
            fullscreen_enter_en: 'Toggle Fullscreen',
            fullscreen_exit_en: 'Exit Fullscreen',

            // ==================== STATE DEFAULTS ====================
            preset_standaard: 'Standaard Dienst',
            preset_doop: 'Doopdienst',
            cl_group_techniek: 'Techniek',
            cl_group_worship: 'Worship',
            cl_group_livestream: 'Livestream',
            cl_group_algemeen: 'Algemeen',
            cl_group_doop: 'Doopdienst',
            cl_item_projectoren: 'Projectoren aan',
            cl_item_lobby_ndi: 'Lobby NDI Feed checken',
            cl_item_lichtplan: 'Lichtplan laden',
            cl_item_soundcheck: 'Soundcheck & In-ears',
            cl_item_lyrics: 'Lyrics syncen',
            cl_item_band: 'Band klaar op podium',
            cl_item_lower_thirds: 'Lower thirds test',
            cl_item_stream: 'Stream starten',
            cl_item_audio_levels: 'Audio levels check',
            cl_item_welkom: 'Welkomstlogo op scherm',
            cl_item_koffie: 'Koffie & water klaar',
            cl_item_doopnamen: 'Doopnamen voorbereiden',
            cl_item_handdoeken: 'Handdoeken & Microfoon',
            cl_team_beamer: 'Beamer',
            cl_team_worship: 'Worship',
            cl_team_stream: 'Stream',
            cl_team_media: 'Media',
            cl_team_algemeen: 'Algemeen',
            tag_audio: 'Audio',
            tag_text: 'Tekst',
            tag_beeld: 'Beeld',
            tag_techniek: 'Techniek',

            // ==================== ANALYTICS MODULE ====================
            analytics_look_name: 'Please enter a valid Look Name and Display Name.',
            analytics_confirm_remove: 'Are you sure you want to remove',
            analytics_from_sequence: 'from the sequence?',
            analytics_select_time: 'Please select a valid time.',
            analytics_waiting_first: 'Waiting for first Look to be activated...',
            analytics_no_data: 'No data to export. Please end the session first.',
            analytics_csv_empty: 'CSV file is empty or invalid.',
            analytics_imported: 'Imported',
            analytics_items_from: 'items from',
            analytics_read_error: 'Failed to read the file.',

            // ==================== NDI MODULE ====================
            ndi_searching: 'Zoeken naar NDI bronnen...',
            ndi_none_found: 'Geen NDI bronnen gevonden',
            ndi_source_found: 'bron gevonden',
            ndi_sources_found: 'bronnen gevonden',
            ndi_error: 'Fout bij zoeken: ',
            ndi_empty_text: 'Geen NDI bronnen actief op dit netwerk',
            ndi_empty_hint: 'Zorg dat NDI bronnen actief zijn (bijv. NDI Tools, ProPresenter, vMix)',
            ndi_unknown: 'Onbekend',
            ndi_copy_title: 'Kopieer naam',
            ndi_details_title: 'Details',
            ndi_conn_error: 'Kon geen verbinding maken met de server',
            ndi_conn_hint: 'Controleer of de server draait met NDI ondersteuning',
            ndi_retry: 'Opnieuw proberen',
            ndi_copied: 'Gekopieerd: ',
            ndi_details_header: 'NDI Source Details',
            ndi_details_name: 'Naam',
            ndi_details_ip: 'IP Adres',
            ndi_details_port: 'Poort',
            ndi_details_type: 'Type',
            ndi_details_extra: 'Extra',
            ndi_default_port: 'NDI default',

            // ==================== PATCHBAY MODULE ====================
            pb_add_node: 'Add Node Here',
            pb_paste: 'Plakken',
            pb_copy_canvas: 'Kopieer Canvas',
            pb_export_canvas: 'Exporteer Canvas',
            pb_edit_node: 'Bewerk Node',
            pb_delete_node: 'Verwijder Node',
            pb_copy: 'Kopiëren',
            pb_export: 'Exporteren',
            pb_duplicate: 'Dupliceren',
            pb_rename: 'Hernoemen',
            pb_new_canvas: 'Nieuw Canvas',
            pb_new_folder: 'Nieuwe Map',
            pb_import: 'Importeren...',
            pb_export_all: 'Alles Exporteren...',
            pb_confirm_delete: 'Verwijderen',
            pb_cancel: 'Annuleren',
            pb_ok: 'OK',
            pb_node_title: 'Titel:',
            pb_node_ip: 'IP / Subtekst:',
            pb_node_inputs: 'Ingangen:',
            pb_node_outputs: 'Uitgangen:',
            pb_cable_standard: 'Kabel Standaard:',
            pb_cable_placeholder: 'Voer aangepaste kabel in...',
            pb_unnamed: 'Naamloos Canvas',
            pb_new_folder_name: 'Nieuwe Map',
            pb_ai_import: 'AI Import klaar! Plak prompt tekst om nodes te bouwen.',
            pb_confirm_delete_node: 'Weet je zeker dat je deze node (en alle verbonden kabels) wilt verwijderen?',
            pb_confirm_delete_canvas: 'Weet je zeker dat je het canvas "%s" permanent wilt verwijderen?',
            pb_confirm_overwrite: 'Dit vervangt alle %s lokale patchbay projecten door de cloud versie. Alle niet-opgeslagen wijzigingen gaan verloren. Doorgaan?',
            pb_cloud_save_success: '☁️ Opgeslagen naar Cloud ✓',
            pb_cloud_save_fail: '☁️ Cloud opslag mislukt: ',
            pb_cloud_load_cancelled: '☁️ Laden geannuleerd',
            pb_cloud_no_connection: '☁️ Geen Firebase verbinding',
            pb_status_saved: 'Opgeslagen ✓',
            pb_delete_folder: 'Map "%s" verwijderen? %s canvas(sen) worden verplaatst naar General',

        },

        en: {
            // ==================== GLOBAL ====================
            app_title: 'Ichtus Workspace',
            save: 'Save',
            cancel: 'Cancel',
            delete: 'Delete',
            close: 'Close',
            confirm: 'Confirm',
            edit: 'Edit',
            remove: 'Remove',
            add: 'Add',
            name: 'Name',
            new: 'New',
            copy: 'Copy',
            export: 'Export',
            import: 'Import',
            ok: 'OK',
            loading: 'Loading...',
            overview: 'Overview',
            back: 'Back',
            search: 'Search',
            filter: 'Filter',
            all: 'All',
            none: 'None',
            settings: 'Settings',
            toast_saved: 'Settings saved!',
            toast_copied: 'Copied to clipboard!',
            reset: 'Reset',
            archive: 'Archive',
            'on': 'On',
            off: 'Off',

            // ==================== ROUTER / SIDEBAR ====================
            nav_dashboard: 'Dashboard',
            nav_agenda: 'Agenda',
            nav_checklist: 'Checklists',
            nav_patchbay: 'Patchbay',
            nav_analytics: 'Analytics',
            nav_setlist: 'Setlist',
            nav_ndi: 'NDI',
            nav_settings: 'Settings',

            // ==================== CHECKLIST MODULE ====================
            role_selector_title: 'Select Station',
            role_admin: 'Coordinator',
            role_beamer: 'Beamer Team',
            role_worship: 'Worship Team',
            role_switch: 'Switch Role',

            checklist_title: 'Checklists',
            cl_back: 'Back to overview',
            cl_no_checklists: 'No checklists found',
            cl_new_checklist: 'New checklist',
            cl_manage: 'Manage',
            cl_tags: 'Tags',
            cl_filter_label: 'Filter:',
            cl_clear_filter: 'clear',
            cl_item_name: 'Task name',
            cl_edit_item: 'Edit Item',
            cl_team_placeholder: 'E.g. Beamer',
            cl_empty_items: 'No items in this checklist yet',
            cl_add_item: 'Add item',
            cl_completed: 'completed',

            cl_item_mark_open: 'Mark open',
            cl_item_mark_done: 'Mark completed',

            cl_new_item_title: 'New Item',
            cl_item_name_placeholder: 'E.g. Turn on projector',
            cl_deadline_time: 'Deadline time',
            cl_team: 'Team',
            cl_add: 'Add',
            cl_create_checklist: 'New Checklist',
            cl_checklist_name: 'Checklist name',
            cl_checklist_duedate: 'Due date',
            cl_checklist_duetime: 'Start time',
            cl_checklist_repeat: 'Repeat',
            cl_repeat_none: 'None',
            cl_repeat_daily: 'Daily',
            cl_repeat_weekly: 'Weekly',
            cl_repeat_biweekly: 'Biweekly',
            cl_repeat_monthly: 'Monthly',
            cl_repeat_yearly: 'Yearly',
            cl_edit_checklist: 'Edit Checklist',
            cl_edit_items: 'Items',
            cl_edit_new_item_placeholder: 'New item name...',
            cl_edit_item_delete_confirm: 'Delete item?',
            cl_edit_no_tags: 'No tags yet',
            cl_edit_no_checklists: 'No checklists',
            cl_edit_items_count: 'items',

            cl_confirm_delete_checklist: 'Are you sure you want to delete this checklist?',
            cl_confirm_delete_item: 'Are you sure you want to delete this item?',
            cl_confirm_delete_tag: 'Are you sure you want to delete this tag?',
            cl_confirm_archive: 'Archive current service and reset?',
            cl_checklist_not_found: 'Checklist not found',

            cl_legacy_no_tasks: 'No tasks found for the selected role',
            cl_legacy_delete_task: 'Permanently delete task?',

            cl_preset_new_name: 'Name for the new service list:',
            cl_preset_dup_suffix: '(Copy)',
            cl_preset_rename_prompt: 'New name for',
            cl_preset_cannot_delete: 'You cannot delete the last list.',
            cl_preset_confirm_delete: 'Are you sure you want to delete the list',
            cl_preset_wilt_verwijderen: '?',

            cl_tag_manager: 'Tag Manager',
            cl_tag_name: 'Tag name',
            cl_tag_icon: 'Icon',
            cl_tag_color: 'Color',
            cl_tag_add: 'Add Tag',

            // ==================== AGENDA MODULE ====================
            agenda_visible: 'Visible (Click title to rename):',
            agenda_fetching: 'Fetching...',
            agenda_template_restored: 'Template restored from memory.',
            agenda_image_too_large: 'Image too large for LocalStorage!',
            agenda_this_week: 'This Week',
            agenda_week: 'Week',
            agenda_items_visible: 'items visible.',
            agenda_no_items: 'No items selected.',
            agenda_events_found: 'events found...',
            agenda_ical_error: 'ICAL library problem: ',
            agenda_network_error: 'Network error — CORS proxy unreachable. Try reloading.',
            agenda_server_error: 'Server error: ',
            agenda_error: 'Error: ',


            // ==================== SETLIST MODULE ====================
            setlist_waiting: 'Waiting for setlist from WorshipTools...',
            setlist_extract_help: 'Open WorshipTools, go to Planning, and click "Extract Setlist" in the Chrome extension.',
            setlist_received: 'Setlist received from WorshipTools',
            setlist_received_at: 'Received:',
            setlist_service_date: 'Service date:',
            setlist_no_date: 'No date received (playlist will be "Web Sync")',
            setlist_testing: 'Testing...',
            setlist_connected: 'Connected ✓',
            setlist_test_connection: '🔍 Test Connection',
            setlist_new_template: 'New Template',
            setlist_confirm_delete: 'Are you sure you want to delete',
            setlist_wilt_verwijderen: '?',
            setlist_confirm_reset: 'Reset to default settings? All changes will be lost.',
            setlist_cannot_delete_last: 'You cannot delete the last template.',
            setlist_cleared: 'Setlist cleared.',
            setlist_syncing: 'Syncing...',


            setlist_empty_preview: 'Open WorshipTools, go to Planning, and click "Extract Setlist" in the Chrome extension.',
            setlist_header_name: 'Header/Item Name',
            setlist_target_uuid: 'Target UUID',
            setlist_destination: 'Destination',

            // ==================== SETTINGS MODULE ====================
            settings_title: 'Settings',
            settings_subtitle: 'View and manage your app configuration',
            settings_language: 'Language',
            settings_language_desc: 'Select the display language of the application',
            settings_dutch: 'Nederlands',
            settings_english: 'English',
            settings_firebase: 'Firebase Configuration',
            settings_not_configured: 'Firebase is not configured.',
            settings_configure: 'Configure Firebase',
            settings_edit: 'Edit Firebase Config',
            settings_reset: 'Reset Firebase Config',
            settings_network: 'Network & Sync',
            settings_offline: 'Offline Mode',
            settings_offline_desc: 'Allow the app to work without an internet connection',
            settings_debug: 'Show Debug Panel',
            settings_debug_desc: 'Show Firebase status and sync logs',
            settings_ndi: 'NDI Video',
            settings_ndi_auto: 'Auto-Discovery',
            settings_ndi_auto_desc: 'Automatically search for NDI sources',
            settings_ndi_quality: 'Preview Quality',
            settings_ndi_quality_desc: 'Image quality for NDI preview (performance impact)',
            settings_ndi_low: 'Low',
            settings_ndi_medium: 'Medium',
            settings_ndi_high: 'High',
            settings_display: 'Display',
            settings_clock: 'Time Format',
            settings_clock_desc: 'How times are displayed',
            settings_clock_12h: '12-hour (2:30 PM)',
            settings_clock_24h: '24-hour (14:30)',
            settings_date: 'Date Format',
            settings_date_desc: 'How dates are displayed',
            settings_date_dmy: 'DD-MM-YYYY (25-12-2024)',
            settings_date_mdy: 'MM-DD-YYYY (12-25-2024)',
            settings_data: 'Data Management',
            settings_clear_cache: 'Clear Firebase Cache',
            settings_clear_cache_desc: 'Remove locally cached Firebase data',
            settings_clear_all: 'Clear All Local Data',
            settings_clear_all_desc: 'Reset all settings and local data',
            settings_clear_cache_btn: 'Clear Cache',
            settings_clear_all_btn: 'Clear All',
            settings_app_info: 'App Info',
            settings_version: 'App Version',
            settings_firebase_status: 'Firebase Status',
            settings_configured: 'Configured',
            settings_not_configured_status: 'Not configured',
            settings_config_source: 'Firebase Config Source',
            settings_offline_status: 'Offline Mode',
            settings_active: 'Active',
            settings_inactive: 'Inactive',
            settings_confirm_reset_firebase: 'Are you sure you want to reset the Firebase configuration? You will need to sign in again.',
            settings_confirm_clear_cache: 'Clear Firebase cache? This removes locally cached data but keeps your settings.',
            settings_confirm_clear_all: 'WARNING: This will clear ALL local data including settings, agenda, and checklists. This cannot be undone! Continue?',
            settings_confirm_clear_all2: 'Are you sure? Type ok in the next prompt.',
            settings_edit_title: 'Edit Firebase Config',
            settings_save_firebase: 'Save',
            settings_cancel: 'Cancel',
            settings_invalid_api: 'Invalid API Key format (must start with AIza)',
            settings_required_fields: 'API Key, Project ID and App ID are required.',
            settings_saved_firebase: 'Firebase configuration saved!',
            settings_cleared_cache: 'Firebase cache cleared!',
            settings_cleared_all: 'All data cleared!',
            settings_reset_firebase: 'Firebase configuration reset',
            settings_config_source_browser: 'Browser (localStorage)',
            settings_config_source_server: 'Server Injected',
            settings_config_source_global: 'Global Variable',
            settings_config_source_none: 'Not configured',

            // ==================== FULLSCREEN ====================
            fullscreen_enter: 'Toggle Fullscreen',
            fullscreen_exit: 'Exit Fullscreen',
            fullscreen_enter_en: 'Toggle Fullscreen',
            fullscreen_exit_en: 'Exit Fullscreen',

            // ==================== STATE DEFAULTS ====================
            preset_standaard: 'Standard Service',
            preset_doop: 'Baptism Service',
            cl_group_techniek: 'Tech',
            cl_group_worship: 'Worship',
            cl_group_livestream: 'Livestream',
            cl_group_algemeen: 'General',
            cl_group_doop: 'Baptism',
            cl_item_projectoren: 'Turn on projectors',
            cl_item_lobby_ndi: 'Check lobby NDI feed',
            cl_item_lichtplan: 'Load lighting preset',
            cl_item_soundcheck: 'Soundcheck & In-ears',
            cl_item_lyrics: 'Sync lyrics',
            cl_item_band: 'Band ready on stage',
            cl_item_lower_thirds: 'Test lower thirds',
            cl_item_stream: 'Start stream',
            cl_item_audio_levels: 'Check audio levels',
            cl_item_welkom: 'Welcome logo on screen',
            cl_item_koffie: 'Coffee & water ready',
            cl_item_doopnamen: 'Prepare baptism names',
            cl_item_handdoeken: 'Towels & Microphone',
            cl_team_beamer: 'Beamer',
            cl_team_worship: 'Worship',
            cl_team_stream: 'Stream',
            cl_team_media: 'Media',
            cl_team_algemeen: 'General',
            tag_audio: 'Audio',
            tag_text: 'Text',
            tag_beeld: 'Visual',
            tag_techniek: 'Tech',

            // ==================== ANALYTICS MODULE ====================
            analytics_look_name: 'Please enter a valid Look Name and Display Name.',
            analytics_confirm_remove: 'Are you sure you want to remove',
            analytics_from_sequence: 'from the sequence?',
            analytics_select_time: 'Please select a valid time.',
            analytics_waiting_first: 'Waiting for first Look to be activated...',
            analytics_no_data: 'No data to export. Please end the session first.',
            analytics_csv_empty: 'CSV file is empty or invalid.',
            analytics_imported: 'Imported',
            analytics_items_from: 'items from',
            analytics_read_error: 'Failed to read the file.',

            // ==================== PATCHBAY MODULE ====================
            pb_add_node: 'Add Node Here',
            pb_paste: 'Paste',
            pb_copy_canvas: 'Copy Canvas',
            pb_export_canvas: 'Export Canvas',
            pb_edit_node: 'Edit Node',
            pb_delete_node: 'Delete Node',
            pb_copy: 'Copy',
            pb_export: 'Export',
            pb_duplicate: 'Duplicate',
            pb_rename: 'Rename',
            pb_new_canvas: 'New Canvas',
            pb_new_folder: 'New Folder',
            pb_import: 'Import...',
            pb_export_all: 'Export All...',
            pb_confirm_delete: 'Delete',
            pb_cancel: 'Cancel',
            pb_ok: 'OK',
            pb_node_title: 'Title:',
            pb_node_ip: 'IP / Subtext:',
            pb_node_inputs: 'Inputs:',
            pb_node_outputs: 'Outputs:',
            pb_cable_standard: 'Cable Standard:',
            pb_cable_placeholder: 'Enter custom cable...',
            pb_unnamed: 'Unnamed Canvas',
            pb_new_folder_name: 'New Folder',
            pb_ai_import: 'AI Import ready hook! Paste prompt text here to build nodes.',
            pb_confirm_delete_node: 'Are you sure you want to delete this node (and all connected cables)?',
            pb_confirm_delete_canvas: 'Are you sure you want to permanently delete the canvas "%s"?',
            pb_confirm_overwrite: 'This will replace all %s local patchbay projects with the cloud version. All unsaved changes will be lost. Continue?',
            pb_cloud_save_success: '☁️ Saved to Cloud ✓',
            pb_cloud_save_fail: '☁️ Cloud save failed: ',
            pb_cloud_load_cancelled: '☁️ Load cancelled',
            pb_cloud_no_connection: '☁️ No Firebase connection',
            pb_status_saved: 'Saved ✓',
            pb_delete_folder: 'Delete folder "%s"? %s canvas(es) will be moved to General',
        }
    },

    // Translate static HTML elements with data-i18n attributes
    translateUI() {
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            if (key) {
                el.textContent = this.t(key);
            }
        });
    },

    // Initialize: detect language from settingsModule or localStorage
    init() {
        // Check settingsModule first (if loaded)
        if (typeof settingsModule !== 'undefined' && settingsModule.settings && settingsModule.settings.language) {
            this.lang = settingsModule.settings.language;
        } else {
            // Check localStorage directly
            const saved = localStorage.getItem('ichtus_settings');
            if (saved) {
                try {
                    const parsed = JSON.parse(saved);
                    if (parsed.language) {
                        this.lang = parsed.language;
                    }
                } catch (e) {}
            }
        }
        // Apply language to html lang attribute
        document.documentElement.lang = this.lang;
        
        // Translate static HTML elements
        this.translateUI();
    },

    // Translate a key
    t(key, ...args) {
        const str = this.strings[this.lang]?.[key] || this.strings['nl']?.[key] || key;
        // Simple interpolation for %s placeholders
        if (args.length > 0) {
            return str.replace(/%s/g, () => args.shift() || '');
        }
        return str;
    },

    // Set language and persist
    setLang(lang) {
        if (!this.strings[lang]) return;
        this.lang = lang;
        document.documentElement.lang = lang;
        // Save to settings if settingsModule is available
        if (typeof settingsModule !== 'undefined' && settingsModule.settings) {
            settingsModule.settings.language = lang;
            settingsModule.saveSettings();
        } else {
            // Fallback: save to localStorage directly
            const saved = localStorage.getItem('ichtus_settings');
            try {
                const parsed = saved ? JSON.parse(saved) : {};
                parsed.language = lang;
                localStorage.setItem('ichtus_settings', JSON.stringify(parsed));
            } catch (e) {}
        }
    }
};

// Global helper function for easy inline translation
function __(key, ...args) {
    return i18n.t(key, ...args);
}

// Initialize on load
i18n.init();
