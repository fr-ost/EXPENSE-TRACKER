package io.github.fr_ost.hisab.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import io.github.fr_ost.hisab.core.BalanceTotals
import io.github.fr_ost.hisab.core.CheckpointSource
import io.github.fr_ost.hisab.core.Edits
import io.github.fr_ost.hisab.core.Transaction
import io.github.fr_ost.hisab.data.Outcome
import io.github.fr_ost.hisab.ui.theme.paletteColor

/** Every account and what it holds today. */
@Composable
fun AccountsScreen(book: Book) {
    val navigator = LocalNavigator.current
    var showInactive by rememberSaveable { mutableStateOf(false) }
    val active = book.summaries.filter { it.account.isActive }
    val inactive = book.summaries.filter { !it.account.isActive }
    val totals = remember(book) { BalanceTotals.of(active, book.currencies.conversion) }

    Column(Modifier.fillMaxSize()) {
        ScreenBar("Accounts")
        LazyColumn(contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 88.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            item {
                Column {
                    Text("Total balance", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(book.format.money(totals.total), style = MaterialTheme.typography.headlineMedium)
                }
            }
            if (book.summaries.isEmpty()) {
                item {
                    Empty("No accounts yet", "Add your cash, bank accounts, wallets and cards.") {
                        Button(onClick = { navigator.sheet = Sheet.NewAccount }) { Text("Add an account") }
                    }
                }
            }
            if (active.isNotEmpty()) {
                item {
                    Section(null) {
                        active.forEachIndexed { index, s ->
                            if (index > 0) RowDivider()
                            ListRow(
                                title = s.account.name,
                                subtitle = listOfNotNull(Format.accountType(s.account.type), s.account.currency.takeIf { it != book.format.base }).joinToString(" · "),
                                leading = { Dot(paletteColor(s.account.color ?: "slate"), label = s.account.name) },
                                trailing = { AmountText(s.balance, book.format, currency = s.account.currency) },
                                onClick = { navigator.open(Screen.AccountDetail(s.account.id)) },
                            )
                        }
                    }
                }
            }
            if (inactive.isNotEmpty()) {
                item {
                    TextButton(onClick = { showInactive = !showInactive }) {
                        Text(if (showInactive) "Hide inactive accounts" else "Show ${inactive.size} inactive ${if (inactive.size == 1) "account" else "accounts"}")
                    }
                }
                if (showInactive) {
                    item {
                        Section(null) {
                            inactive.forEachIndexed { index, s ->
                                if (index > 0) RowDivider()
                                ListRow(
                                    title = s.account.name,
                                    subtitle = "Inactive",
                                    leading = { Dot(paletteColor("gray"), label = s.account.name) },
                                    trailing = { AmountText(s.balance, book.format, currency = s.account.currency) },
                                    onClick = { navigator.open(Screen.AccountDetail(s.account.id)) },
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

/** One account: its balance, how it got there, its balance updates and its entries. */
@Composable
fun AccountDetailScreen(book: Book, id: String) {
    val navigator = LocalNavigator.current
    val repository = LocalRepository.current
    val messages = LocalMessages.current
    val summary = book.summaries.firstOrNull { it.account.id == id }
    if (summary == null) {
        Column { ScreenBar("Account"); Empty("This account is gone", "It was deleted, perhaps on another phone.") }
        return
    }
    val account = summary.account
    val format = book.format
    var confirmDelete by remember { mutableStateOf(false) }
    val entries = remember(book, id) {
        book.live.transactions.filter { it.accountId == id || it.toAccountId == id }
            .sortedWith(compareByDescending<Transaction> { it.date }.thenByDescending { it.time ?: it.loggedTime ?: "24:00" }.thenByDescending { it.createdAt })
    }
    val updates = remember(book, id) { book.live.checkpoints.filter { it.accountId == id }.sortedWith(compareByDescending<io.github.fr_ost.hisab.core.Checkpoint> { it.date }.thenByDescending { it.createdAt }) }
    val corrections = remember(book, id) { book.ledger.corrections.filter { it.accountId == id }.associate { it.checkpointId to it.amount } }

    Column(Modifier.fillMaxSize()) {
        ScreenBar(account.name) {
            IconButton(onClick = { navigator.sheet = Sheet.EditAccount(id) }) { Icon(Icons.Outlined.Edit, contentDescription = "Edit account") }
        }
        LazyColumn(contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 88.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            item {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(listOfNotNull(Format.accountType(account.type), account.currency, if (account.isActive) null else "Inactive").joinToString(" · "),
                        style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(format.money(summary.balance, account.currency), style = MaterialTheme.typography.headlineLarge.copy(fontWeight = FontWeight.SemiBold))
                    summary.lastUpdate?.let {
                        Text(
                            "Balance updated ${Format.date(it.messageDate ?: it.date)}${if (it.source == CheckpointSource.SMS) " from an SMS" else ""}",
                            style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(onClick = { navigator.sheet = Sheet.UpdateBalance(id) }) { Text("Update balance") }
                    OutlinedButton(onClick = { navigator.sheet = Sheet.NewTransaction(id) }) { Text("Add entry") }
                }
            }
            item {
                Section("Since ${Format.date(account.openingDate)}") {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Line("Opening balance", format.money(account.openingBalance, account.currency))
                        Line("Money in", format.money(summary.inflow, account.currency))
                        Line("Money out", format.money(-summary.outflow, account.currency))
                        if (summary.corrections != 0L) Line("Balance updates", format.money(summary.corrections, account.currency, io.github.fr_ost.hisab.core.Money.Sign.ALWAYS))
                        Line("Balance", format.money(summary.balance, account.currency), bold = true)
                    }
                }
            }
            if (updates.isNotEmpty()) {
                item {
                    Section("Balance updates") {
                        updates.take(10).forEachIndexed { index, c ->
                            if (index > 0) RowDivider()
                            val correction = corrections[c.id] ?: 0L
                            ListRow(
                                title = format.money(c.balance, account.currency),
                                subtitle = listOfNotNull(
                                    Format.date(c.messageDate ?: c.date),
                                    (c.messageTime ?: c.time)?.let(Format::time),
                                    if (c.source == CheckpointSource.SMS) "from SMS" else null,
                                    if (correction != 0L) "corrected ${format.money(correction, account.currency, io.github.fr_ost.hisab.core.Money.Sign.ALWAYS)}" else null,
                                ).joinToString(" · "),
                                trailing = {
                                    TextButton(onClick = {
                                        repository.edit { Edits.deleteCheckpoint(it, c.id) }
                                        messages.show("Balance update removed")
                                    }) { Text("Remove") }
                                },
                            )
                        }
                    }
                }
            }
            item {
                Section("Entries") {
                    if (entries.isEmpty()) {
                        Empty("No entries", "Entries on this account show here.")
                    } else {
                        entries.take(100).forEachIndexed { index, t ->
                            if (index > 0) RowDivider()
                            TransactionRow(book, t)
                        }
                    }
                }
            }
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = {
                        repository.edit { data ->
                            listOf(Edits.saveAccount(data, io.github.fr_ost.hisab.core.AccountInput(account.name, account.type, account.currency, account.openingBalance,
                                account.openingDate, !account.isActive, account.icon, account.color), id))
                        }
                        messages.show(if (account.isActive) "${account.name} is inactive" else "${account.name} is active again")
                    }) { Text(if (account.isActive) "Deactivate" else "Reactivate") }
                    if (entries.isEmpty()) TextButton(onClick = { confirmDelete = true }) { Text("Delete") }
                }
            }
        }
    }
    if (confirmDelete) {
        Confirm("Delete ${account.name}?", "It has no entries. This can't be undone.", "Delete", onConfirm = {
            confirmDelete = false
            when (val outcome = repository.edit { Edits.deleteAccount(it, id) }) {
                Outcome.Done -> {
                    messages.show("${account.name} deleted")
                    navigator.back()
                }
                is Outcome.Refused -> messages.show(outcome.message)
            }
        }, onDismiss = { confirmDelete = false })
    }
}

@Composable
private fun Line(label: String, value: String, bold: Boolean = false) {
    Row(Modifier.fillMaxWidth()) {
        Text(label, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
        Text(value, style = MaterialTheme.typography.bodyMedium, fontWeight = if (bold) FontWeight.SemiBold else FontWeight.Normal)
    }
}
