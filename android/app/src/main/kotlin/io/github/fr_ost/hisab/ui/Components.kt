@file:OptIn(ExperimentalMaterial3Api::class)

package io.github.fr_ost.hisab.ui

import android.app.DatePickerDialog
import android.app.TimePickerDialog
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.github.fr_ost.hisab.core.Money
import io.github.fr_ost.hisab.ui.theme.amountColor
import java.time.LocalDate
import java.time.LocalTime

/** An amount, green when money came in. */
@Composable
fun AmountText(
    minor: Long,
    format: Format,
    modifier: Modifier = Modifier,
    currency: String = format.base,
    signed: Boolean = false,
    style: androidx.compose.ui.text.TextStyle = MaterialTheme.typography.bodyLarge,
) {
    Text(
        text = format.money(minor, currency, if (signed) Money.Sign.ALWAYS else Money.Sign.NEGATIVE),
        style = style,
        color = if (signed) amountColor(minor) else MaterialTheme.colorScheme.onSurface,
        fontWeight = FontWeight.Medium,
        maxLines = 1,
        modifier = modifier,
    )
}

/** A titled block of content. */
@Composable
fun Section(title: String?, modifier: Modifier = Modifier, action: (@Composable () -> Unit)? = null, content: @Composable ColumnScope.() -> Unit) {
    Column(modifier.fillMaxWidth()) {
        if (title != null) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(title, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                action?.invoke()
            }
        }
        OutlinedCard(Modifier.fillMaxWidth()) { content() }
    }
}

/** A row in a list: a leading mark, a title and subtitle, and whatever goes at the end. */
@Composable
fun ListRow(
    title: String,
    subtitle: String? = null,
    leading: (@Composable () -> Unit)? = null,
    trailing: (@Composable () -> Unit)? = null,
    onClick: (() -> Unit)? = null,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (leading != null) {
            leading()
            Spacer(Modifier.width(12.dp))
        }
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (!subtitle.isNullOrEmpty()) {
                Text(subtitle, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        if (trailing != null) {
            Spacer(Modifier.width(12.dp))
            trailing()
        }
    }
}

/** A row that opens somewhere else. */
@Composable
fun NavRow(title: String, subtitle: String? = null, icon: ImageVector? = null, onClick: () -> Unit) {
    ListRow(
        title = title,
        subtitle = subtitle,
        leading = icon?.let { { Icon(it, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant) } },
        trailing = { Icon(Icons.Default.ChevronRight, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant) },
        onClick = onClick,
    )
}

@Composable
fun RowDivider() = HorizontalDivider(Modifier.padding(start = 16.dp), color = MaterialTheme.colorScheme.outlineVariant)

/** A small coloured disc: a category's or account's mark. */
@Composable
fun Dot(color: Color, size: Int = 28, label: String? = null) {
    Box(Modifier.size(size.dp).background(color.copy(alpha = 0.16f), CircleShape), contentAlignment = Alignment.Center) {
        if (label != null) {
            Text(label.take(1).uppercase(), style = MaterialTheme.typography.labelMedium, color = color, fontWeight = FontWeight.Bold)
        } else {
            Box(Modifier.size((size / 3).dp).background(color, CircleShape))
        }
    }
}

/** Choose one of a few options, shown as a field that opens a menu. */
@Composable
fun <T> PickerField(
    label: String,
    value: T?,
    options: List<T>,
    text: (T) -> String,
    onPick: (T) -> Unit,
    modifier: Modifier = Modifier,
    error: String? = null,
    placeholder: String = "Choose",
) {
    var open by remember { mutableStateOf(false) }
    Box(modifier) {
        OutlinedTextField(
            value = value?.let(text) ?: "",
            onValueChange = {},
            readOnly = true,
            label = { Text(label) },
            placeholder = { Text(placeholder) },
            trailingIcon = { Icon(Icons.Default.ArrowDropDown, contentDescription = null) },
            isError = error != null,
            supportingText = error?.let { { Text(it) } },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        // The whole field opens the menu (a read-only text field would otherwise take the tap).
        Box(Modifier.matchParentSize().padding(bottom = if (error != null) 20.dp else 0.dp).clickable { open = true })
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            options.forEach { option ->
                DropdownMenuItem(text = { Text(text(option)) }, onClick = {
                    open = false
                    onPick(option)
                })
            }
        }
    }
}

/** An amount being typed: digits, one point, two decimals. */
@Composable
fun AmountField(
    label: String,
    value: String,
    onChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    error: String? = null,
    prefix: String? = null,
    allowNegative: Boolean = false,
) {
    OutlinedTextField(
        value = value,
        onValueChange = { typed ->
            val clean = typed.replace(",", "").replace(" ", "")
            val pattern = if (allowNegative) Regex("""^-?\d{0,12}(\.\d{0,2})?$""") else Regex("""^\d{0,12}(\.\d{0,2})?$""")
            if (pattern.matches(clean)) onChange(clean)
        },
        label = { Text(label) },
        prefix = prefix?.let { { Text(it) } },
        isError = error != null,
        supportingText = error?.let { { Text(it) } },
        keyboardOptions = KeyboardOptions(keyboardType = if (allowNegative) KeyboardType.Text else KeyboardType.Decimal),
        singleLine = true,
        modifier = modifier.fillMaxWidth(),
    )
}

/** A date, chosen with the phone's calendar. */
@Composable
fun DateField(label: String, value: String, onChange: (String) -> Unit, modifier: Modifier = Modifier, error: String? = null) {
    val context = LocalContext.current
    Box(modifier) {
        OutlinedTextField(
            value = Format.date(value),
            onValueChange = {},
            readOnly = true,
            label = { Text(label) },
            isError = error != null,
            supportingText = error?.let { { Text(it) } },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        Box(
            Modifier.matchParentSize().clickable {
                val date = runCatching { LocalDate.parse(value) }.getOrElse { LocalDate.now() }
                DatePickerDialog(context, { _, y, m, d -> onChange(LocalDate.of(y, m + 1, d).toString()) }, date.year, date.monthValue - 1, date.dayOfMonth).show()
            },
        )
    }
}

/** A time of day, or none. */
@Composable
fun TimeField(label: String, value: String?, onChange: (String?) -> Unit, modifier: Modifier = Modifier, error: String? = null) {
    val context = LocalContext.current
    Row(modifier, verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.weight(1f)) {
            OutlinedTextField(
                value = value?.let(Format::time) ?: "",
                onValueChange = {},
                readOnly = true,
                label = { Text(label) },
                placeholder = { Text("Any time") },
                isError = error != null,
                supportingText = error?.let { { Text(it) } },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            Box(
                Modifier.matchParentSize().clickable {
                    val time = value?.let { runCatching { LocalTime.parse(it) }.getOrNull() } ?: LocalTime.now()
                    TimePickerDialog(context, { _, h, m -> onChange("%02d:%02d".format(h, m)) }, time.hour, time.minute, false).show()
                },
            )
        }
        if (value != null) TextButton(onClick = { onChange(null) }) { Text("Clear") }
    }
}

/** "Are you sure?" */
@Composable
fun Confirm(title: String, text: String, confirm: String, onConfirm: () -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { Text(text) },
        confirmButton = { TextButton(onClick = onConfirm) { Text(confirm) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

/** Nothing here yet, and what to do about it. */
@Composable
fun Empty(title: String, text: String, modifier: Modifier = Modifier, action: (@Composable () -> Unit)? = null) {
    Column(modifier.fillMaxWidth().padding(PaddingValues(24.dp)), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(title, style = MaterialTheme.typography.titleMedium)
        Text(text, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        action?.invoke()
    }
}

/** A month and arrows to move between months (never past this one). */
@Composable
fun MonthSwitcher(month: String, onChange: (String) -> Unit, modifier: Modifier = Modifier) {
    val current = Format.thisMonth()
    Row(modifier, verticalAlignment = Alignment.CenterVertically) {
        TextButton(onClick = { onChange(io.github.fr_ost.hisab.core.Dates.shiftMonth(month, -1)) }) { Text("‹") }
        Text(Format.month(month), style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f, fill = false))
        TextButton(onClick = { onChange(io.github.fr_ost.hisab.core.Dates.shiftMonth(month, 1)) }, enabled = month < current) { Text("›") }
    }
}
