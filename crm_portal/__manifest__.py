{
    'name': 'CRM Portal',
    'version': '19.0.1.0.0',
    'author': 'shamna',
    'category': 'Website',
    'summary': 'CRM Portal with Odoo-style CRM Pipeline',
    'depends': [
        'base',
        'crm',
        'portal',
        'website',
    ],

    'data': [
        'views/portal_crm_templates.xml',
        'views/crm_team_views.xml',
        'views/crm_lead_views.xml',
    ],

    'assets': {
        'web.assets_frontend': [
            'crm_portal/static/src/js/portal_crm.js',
            'crm_portal/static/src/xml/portal_crm.xml',
            'crm_portal/static/src/css/portal_crm.css',
        ],
    },

    'installable': True,
    'application': True,
}