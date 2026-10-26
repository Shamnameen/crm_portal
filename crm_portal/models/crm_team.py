from odoo import fields, models


class CrmTeam(models.Model):
    _inherit = "crm.team"

    member_ids = fields.Many2many(
        domain="[('active', '=', True), "
               "('company_ids', 'in', member_company_ids)]",
    )
