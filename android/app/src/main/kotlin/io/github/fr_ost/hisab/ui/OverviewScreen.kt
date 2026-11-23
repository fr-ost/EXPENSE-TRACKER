@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package io.github.fr_ost.hisab.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.Button
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedCard
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
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.fr_ost.hisab.core.BalanceTotals
import io.github.fr_ost.hisab.core.Dates
import io.github.fr_ost.hisab.core.Edits
import io.github.fr_ost.hisab.core.ExpenseScope
import io.github.fr_ost.hisab.ui.theme.Palette
import io.github.fr_ost.hisab.ui.theme.paletteColor

/** The first screen: what you hold, this month's money in and out, budgets, and the latest entries. */
@Composable
fun OverviewScreen(book: Book) {
    val navigator = LocalNavigator.current
    var month by rememberSaveable { mutableStateOf(Dates.monthOf(book.today)) }
    val fx = book.currencies.conversion
    val format = book.format
    val totals = remember(book) { BalanceTotals.of(book.summaries.filter { it.account.isActive }, fx) }
    val summary = remember(book, month) { book.analytics.periodSummary(Dates.monthStart(month), Dates.monthEnd(month), fx) }
    val scopes = remember(book, month) { book.analytics.scopeTotals(Dates.monthStart(month), Dates.monthEnd(month), fx) }
    val recent = remember(book) {
        book.live.transactions.filter { it.date <= book.today }
            .sortedWith(compareByDescending<io.github.fr_ost.hisab.core.Transaction> { it.date }.thenByDescending { it.time ?: it.loggedTime ?: "24:00" }.thenByDescending { it.createdAt })
            .take(6)
    }

    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        item {
            Column {
                Text(Format.longDate(book.today), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                val name = book.settings.displayName.trim().split(" ").firstOrNull().orEmpty()
                Text(if (name.isEmpty()) Format.greeting() else "${Format.greeting()}, $name", style = MaterialTheme.typography.headlineMedium)
            }
        }

        item {
            val waiting by LocalRepository.current.waiting.collectAsStateWithLifecycle()
            if (waiting.isNotEmpty()) {
                OutlinedCard(onClick = {
                    navigator.tab(Screen.More)
                    navigator.open(Screen.Sms)
                }, modifier = Modifier.fillMaxWidth()) {
                    ListRow(
                        title = "${waiting.size} SMS ${if (waiting.size == 1) "needs" else "need"} a look",
                        subtitle = "Hisab couldn't add ${if (waiting.size == 1) "it" else "them"} by itself",
                    )
                }
            }
        }

        if (book.live.accounts.isEmpty()) {
            item {
                OutlinedCard {
                    Empty("Add your first account", "Your cash, bank accounts, bKash and cards — each with what it holds today.") {
                        Button(onClick = { navigator.sheet = Sheet.NewAccount }) { Text("Add an account") }
                    }
                }
            }
            return@LazyColumn
        }

        item {
            Column {
                Text("Total balance", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(format.money(totals.total), style = MaterialTheme.typography.headlineLarge.copy(fontWeight = FontWeight.SemiBold))
                if (totals.byCurrency.size > 1) {
                    Text(
                        totals.byCurrency.joinToString("  ·  ") { (currency, amount, rate) -> format.money(amount, currency) + if (rate == null) " (not counted)" else "" },
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                } else {
                    val active = book.live.accounts.count { it.isActive }
                    Text("Across $active ${if (active == 1) "account" else "accounts"}", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }

        item { MonthSwitcher(month, { month = it }) }

        item {
            OutlinedCard(Modifier.fillMaxWidth()) {
                Row(Modifier.padding(16.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    Figure("Income", format.money(summary.income), Modifier.weight(1f))
                    Figure("Spending", format.money(summary.expenses), Modifier.weight(1f))
                    Figure("Saved", format.money(summary.netSavings), Modifier.weight(1f), note = summary.savingsRate?.let { "%.0f%%".format(it) })
                }
            }
        }

        val budgets = ExpenseScope.entries.mapNotNull { scope -> Edits.budgetFor(book.live, scope, month)?.takeIf { it.amount > 0 }?.let { scope to it.amount } }
        if (budgets.isNotEmpty()) {
            item {
                Section("Budgets", action = { TextButton(onClick = { navigator.open(Screen.Budgets) }) { Text("All") } }) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        budgets.forEach { (scope, amount) ->
                            val spent = scopes.firstOrNull { it.scope == scope }?.total ?: 0L
                            BudgetBar(if (scope == ExpenseScope.PERSONAL) "Personal" else "Family", spent, amount, format)
                        }
                    }
                }
            }
        }

        item {
            Section("Accounts", action = { TextButton(onClick = { navigator.tab(Screen.Accounts) }) { Text("All") } }) {
                book.summaries.filter { it.account.isActive }.take(5).forEachIndexed { index, s ->
                    if (index > 0) RowDivider()
                    ListRow(
                        title = s.account.name,
                        subtitle = Format.accountType(s.account.type),
                        leading = { Dot(paletteColor(s.account.color ?: "slate"), label = s.account.name) },
                        trailing = { AmountText(s.balance, format, currency = s.account.currency) },
                        onClick = { navigator.open(Screen.AccountDetail(s.account.id)) },
                    )
                }
            }
        }

        item {
            Section("Recent", action = { TextButton(onClick = { navigator.tab(Screen.Activity) }) { Text("All") } }) {
                if (recent.isEmpty()) {
                    Empty("Nothing recorded yet", "Tap + to add what you spent or received.")
                } else {
                    recent.forEachIndexed { index, t ->
                        if (index > 0) RowDivider()
                        TransactionRow(book, t)
                    }
                }
            }
        }
        item { Spacer(Modifier.height(72.dp)) }
    }
}

@Composable
private fun Figure(label: String, value: String, modifier: Modifier = Modifier, note: String? = null) {
    Column(modifier) {
        Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, style = MaterialTheme.typography.titleMedium, maxLines = 1)
        if (note != null) Text(note, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/** How much of a budget is spent. */
@Composable
fun BudgetBar(label: String, spent: Long, budget: Long, format: Format) {
    val share = if (budget > 0) (spent.toDouble() / budget).toFloat() else 0f
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(Modifier.fillMaxWidth()) {
            Text(label, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
            Text("${format.money(spent)} of ${format.money(budget)}", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        LinearProgressIndicator(
            progress = { share.coerceIn(0f, 1f) },
            modifier = Modifier.fillMaxWidth(),
            color = if (share > 1f) Palette.Negative else if (share > 0.85f) Palette.Warning else Palette.Emerald,
            trackColor = MaterialTheme.colorScheme.surfaceVariant,
        )
        val left = budget - spent
        Text(
            if (left >= 0) "${format.money(left)} left" else "${format.money(-left)} over",
            style = MaterialTheme.typography.labelMedium,
            color = if (left >= 0) MaterialTheme.colorScheme.onSurfaceVariant else Palette.Negative,
        )
    }
}
