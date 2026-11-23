@file:OptIn(ExperimentalMaterial3Api::class)

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
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import io.github.fr_ost.hisab.core.Dates
import io.github.fr_ost.hisab.core.EntryType
import io.github.fr_ost.hisab.core.ExpenseScope
import io.github.fr_ost.hisab.core.Transaction
import io.github.fr_ost.hisab.ui.theme.paletteColor

/** Every entry, newest first, by day: a month at a time, or everything that matches a search. */
@Composable
fun ActivityScreen(book: Book) {
    var month by rememberSaveable { mutableStateOf(Dates.monthOf(book.today)) }
    var query by rememberSaveable { mutableStateOf("") }
    var type by rememberSaveable { mutableStateOf<EntryType?>(null) }
    val entries = remember(book, month, query, type) {
        val words = query.trim().lowercase().split(Regex("\\s+")).filter { it.isNotEmpty() }
        book.live.transactions
            .filter { t ->
                (type == null || t.type == type) &&
                    if (words.isEmpty()) Dates.monthOf(t.date) == month else words.all { w -> searchText(book, t).contains(w) }
            }
            .sortedWith(compareByDescending<Transaction> { it.date }.thenByDescending { it.time ?: it.loggedTime ?: "24:00" }.thenByDescending { it.createdAt })
            .take(if (words.isEmpty()) Int.MAX_VALUE else 300)
    }
    val days = remember(entries) { entries.groupBy { it.date } }

    Column(Modifier.fillMaxSize()) {
        ScreenBar("Activity")
        LazyColumn(contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 88.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item {
                OutlinedTextField(
                    value = query,
                    onValueChange = { query = it },
                    placeholder = { Text("Search descriptions, notes, amounts") },
                    leadingIcon = { Icon(Icons.Outlined.Search, contentDescription = null) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            item {
                LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    val choices = listOf(null to "All", EntryType.EXPENSE to "Spending", EntryType.INCOME to "Income", EntryType.TRANSFER to "Transfers")
                    items(choices) { (value, label) -> FilterChip(selected = type == value, onClick = { type = value }, label = { Text(label) }) }
                }
            }
            if (query.isBlank()) item { MonthSwitcher(month, { month = it }) }
            if (entries.isEmpty()) {
                item { Empty(if (query.isBlank()) "Nothing this month" else "Nothing matches", if (query.isBlank()) "Tap + to add an entry." else "Try other words.") }
            }
            days.forEach { (date, list) ->
                item(key = date) {
                    val net = list.sumOf { netEffect(it) }
                    Row(Modifier.fillMaxWidth().padding(top = 4.dp, start = 4.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(Format.day(date, book.today), style = MaterialTheme.typography.labelLarge, modifier = Modifier.weight(1f))
                        if (net != 0L) AmountText(net, book.format, signed = true, style = MaterialTheme.typography.labelLarge)
                    }
                }
                item(key = "$date-list") {
                    Section(null) {
                        list.forEachIndexed { index, t ->
                            if (index > 0) RowDivider()
                            TransactionRow(book, t)
                        }
                    }
                }
            }
            item { Spacer(Modifier.height(8.dp)) }
        }
    }
}

private fun searchText(book: Book, t: Transaction): String = listOfNotNull(
    t.description,
    t.notes,
    book.categories[t.categoryId]?.name,
    book.accounts[t.accountId]?.name,
    t.toAccountId?.let { book.accounts[it]?.name },
    io.github.fr_ost.hisab.core.Money.decimal(t.amount),
).joinToString(" ").lowercase()

/** What an entry does to what you have, in its own currency: income +, spending −, a transfer 0. */
private fun netEffect(t: Transaction): Long = when (t.type) {
    EntryType.INCOME -> t.amount
    EntryType.EXPENSE -> -t.amount
    else -> 0
}

/** One entry in a list: its category, what it was, where, and how much. */
@Composable
fun TransactionRow(book: Book, t: Transaction) {
    val navigator = LocalNavigator.current
    val account = book.accounts[t.accountId]
    val category = book.categories[t.categoryId]
    val title = t.description.ifBlank {
        when (t.type) {
            EntryType.TRANSFER -> "Transfer"
            EntryType.ADJUSTMENT -> "Adjustment"
            else -> category?.name ?: "Entry"
        }
    }
    val where = when (t.type) {
        EntryType.TRANSFER -> "${account?.name ?: "?"} → ${t.toAccountId?.let { book.accounts[it]?.name } ?: "?"}"
        else -> listOfNotNull(category?.name?.takeIf { it != title }, account?.name).joinToString(" · ")
    }
    val extra = listOfNotNull(
        t.time?.let(Format::time),
        if (t.scope == ExpenseScope.FAMILY) "Family" else null,
        if (!t.affectsBalance) "not in balance" else null,
        if (t.smsKey != null) "SMS" else null,
    ).joinToString(" · ")
    val amount = when (t.type) {
        EntryType.INCOME -> t.amount
        EntryType.EXPENSE -> -t.amount
        EntryType.ADJUSTMENT -> t.amount
        EntryType.TRANSFER -> 0
    }
    ListRow(
        title = title,
        subtitle = listOf(where, extra).filter { it.isNotEmpty() }.joinToString(" · "),
        leading = { Dot(paletteColor(if (t.type == EntryType.TRANSFER) "slate" else category?.color), label = category?.name ?: title) },
        trailing = {
            if (t.type == EntryType.TRANSFER) {
                Text(book.format.money(t.amount, account?.currency ?: book.format.base), style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            } else {
                AmountText(amount, book.format, currency = account?.currency ?: book.format.base, signed = true)
            }
        },
        onClick = { navigator.sheet = Sheet.EditTransaction(t.id) },
    )
}
